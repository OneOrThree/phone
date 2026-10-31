import { objectScoreIndex, studyObjectScores, studyObjectPresence } from './studyObjects';

const inputs = [{ shape: [1, 320, 320, 3], dataType: 'uint8' }];
const scores = (book: number, keyboard = 0, laptop = 0) => ({ book, keyboard, laptop });

test('실제 int8 모델의 90클래스 확률을 고르고 다른 입력/박스 텐서는 거부한다', () => {
  const outputs = [
    { shape: [1, 19206, 4], dataType: 'float32' },
    { shape: [1, 19206, 90], dataType: 'float32' },
  ];
  expect(objectScoreIndex(inputs, outputs)).toBe(1);
  expect(objectScoreIndex([{ ...inputs[0]!, dataType: 'float32' }], outputs)).toBe(-1);
  expect(objectScoreIndex(inputs, [{ shape: [1, 19206, 80], dataType: 'float32' }])).toBe(-1);
});

test('빈 COCO 라벨을 포함한 인덱스로 추출하고 확률에 sigmoid를 다시 씌우지 않는다', () => {
  const raw = new Float32Array(90 * 2);
  raw[72] = 0.8;
  raw[75] = 0.4;
  raw[90 + 75] = 0.9;
  raw[83] = 0.7;
  raw[0] = 1;
  const result = studyObjectScores(raw);
  expect(result.laptop).toBeCloseTo(0.8);
  expect(result.keyboard).toBeCloseTo(0.9);
  expect(result.book).toBeCloseTo(0.7);
  expect(studyObjectScores(new Float32Array(90))).toEqual(scores(0));
});

test('형식이 잘못된 출력은 거부한다', () => {
  expect(() => studyObjectScores(new Float32Array(89))).toThrow('Invalid');
});

test.each([NaN, Infinity, -Infinity, -0.1, 1.1])(
  '비정상 객체 확률 %s는 정상 앵커가 함께 있어도 오류로 보존한다',
  (invalid) => {
    for (const index of [0, 72, 75, 83]) {
      const raw = new Float32Array(90 * 2);
      raw[90 + 83] = 0.9;
      raw[index] = invalid;
      expect(() => studyObjectScores(raw)).toThrow('Invalid object score probability');
    }
  },
);

test('물체마다 같은 3장 중 2장 기준이며 한 장의 오탐으로 감지하지 않는다', () => {
  expect(studyObjectPresence([scores(1)])).toBeNull();
  expect(studyObjectPresence([scores(1), scores(0), scores(0)])).toEqual({
    book: false,
    keyboard: false,
    laptop: false,
  });
  expect(studyObjectPresence([scores(0.5, 0.9), scores(0.5), scores(0, 0.8)])).toEqual({
    book: true,
    keyboard: true,
    laptop: false,
  });
});
