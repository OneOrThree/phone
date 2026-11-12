import { studyObjectModelReady, studyObjectScores, studyObjectPresence } from './studyObjects';

const inputs = [{ shape: [1, 320, 320, 3], dataType: 'uint8' }];
const outputs = [
  { shape: [1, 3], dataType: 'float32' },
  { shape: [1], dataType: 'bool' },
];
const scores = (book: number, keyboard = 0, laptop = 0) => ({ book, keyboard, laptop });
const tensors = (values: number[], valid = 1) => [
  new Float32Array(values).buffer,
  new Uint8Array([valid]).buffer,
];

test('출력 요약 모델의 uint8 입력과 점수 3개·유효성 1개 출력만 받는다', () => {
  expect(studyObjectModelReady(inputs, outputs)).toBe(true);
  expect(studyObjectModelReady([{ ...inputs[0]!, dataType: 'float32' }], outputs)).toBe(false);
  expect(
    studyObjectModelReady(inputs, [
      { shape: [1, 19206, 90], dataType: 'float32' },
      { shape: [1, 19206, 4], dataType: 'float32' },
    ]),
  ).toBe(false);
  expect(studyObjectModelReady(inputs, [outputs[0]!])).toBe(false);
  expect(studyObjectModelReady(inputs, [outputs[0]!, { shape: [1], dataType: 'float32' }])).toBe(
    false,
  );
  expect(studyObjectModelReady(inputs, [{ shape: [3, 1], dataType: 'float32' }, outputs[1]!])).toBe(
    false,
  );
});

test('노트북·키보드·책 순서의 확률을 그대로 읽는다', () => {
  expect(studyObjectScores(tensors([0.8, 0.4, 0.7]))).toEqual({
    laptop: expect.closeTo(0.8),
    keyboard: expect.closeTo(0.4),
    book: expect.closeTo(0.7),
  });
});

test('형식이 잘못된 출력은 거부한다', () => {
  expect(() => studyObjectScores([new Float32Array(2).buffer, new Uint8Array([1]).buffer])).toThrow(
    'Invalid',
  );
  expect(() => studyObjectScores([new Float32Array(3).buffer])).toThrow('Invalid');
});

test.each([NaN, Infinity, -Infinity, -0.1, 1.1])(
  '비정상 확률 %s는 정상 점수와 함께 있어도 오류로 보존한다',
  (invalid) => {
    expect(() => studyObjectScores(tensors([0.9, 0.1, invalid]))).toThrow(
      'Invalid object score probability',
    );
  },
);

test('모델이 원본 90클래스 확률 중 비정상 값을 알리면 오류로 보존한다', () => {
  expect(() => studyObjectScores(tensors([0.1, 0.1, 0.9], 0))).toThrow(
    'Invalid object score probability',
  );
});

test('물체마다 같은 3장 중 2장 기준(0.4)이며 한 장의 오탐으로 감지하지 않는다', () => {
  expect(studyObjectPresence([scores(1)])).toBeNull();
  expect(studyObjectPresence([scores(1), scores(0), scores(0)])).toEqual({
    book: false,
    keyboard: false,
    laptop: false,
  });
  expect(studyObjectPresence([scores(0.4, 0.9), scores(0.45), scores(0, 0.8)])).toEqual({
    book: true,
    keyboard: true,
    laptop: false,
  });
  expect(studyObjectPresence([scores(0.39), scores(0.39), scores(0.39)])?.book).toBe(false);
});
