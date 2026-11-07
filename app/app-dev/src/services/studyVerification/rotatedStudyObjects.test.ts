import { detectRotatedStudyObjects, rotateSquareRgb } from './rotatedStudyObjects';
import { OBJECT_INPUT } from './studyObjects';

const noTool = { book: 0.1, laptop: 0.1, keyboard: 0.1 };
const book = { ...noTool, book: 0.7 };
const pixels = new Uint8Array(OBJECT_INPUT * OBJECT_INPUT * 3).buffer;

test.each([
  [1, [3, 1, 4, 2]],
  [2, [4, 3, 2, 1]],
  [3, [2, 4, 1, 3]],
])('RGB의 채널·픽셀을 유지하며 시계 방향 %s/4회 회전한다', (turns, order) => {
  const source = new Uint8Array([1, 11, 21, 2, 12, 22, 3, 13, 23, 4, 14, 24]);
  expect([...new Uint8Array(rotateSquareRgb(source.buffer, 2, turns))]).toEqual(
    order.flatMap((n) => [n, n + 10, n + 20]),
  );
  const restored = rotateSquareRgb(rotateSquareRgb(source.buffer, 2, turns), 2, 4 - turns);
  expect([...new Uint8Array(restored)]).toEqual([...source]);
});

test('미검출 때만 한 번 더 검사하고 성공 방향만 기억한다', () => {
  const infer = jest.fn().mockReturnValueOnce(noTool).mockReturnValue(book);
  const first = detectRotatedStudyObjects(pixels, { preferred: 0, next: 1 }, true, infer);
  expect(infer).toHaveBeenCalledTimes(2);
  expect(first).toEqual({ scores: book, search: { preferred: 1, next: 2 } });
  infer.mockClear();
  expect(detectRotatedStudyObjects(pixels, first.search, true, infer).scores).toEqual(book);
  expect(infer).toHaveBeenCalledTimes(1);
});

test('계속 못 찾으면 90·180·270도 순서로 나눠 검사하며 한 장에 두 번을 넘기지 않는다', () => {
  const infer = jest.fn().mockReturnValue(noTool);
  let search = { preferred: 0, next: 1 };
  for (const next of [2, 3, 0, 2]) {
    infer.mockClear();
    const result = detectRotatedStudyObjects(pixels, search, true, infer);
    expect(result.search).toEqual({ preferred: 0, next });
    expect(infer).toHaveBeenCalledTimes(2);
    search = result.search;
  }
});

test('손이 없는 프레임에는 추가 추론을 하지 않고 이전 성공 점수도 재사용하지 않는다', () => {
  const infer = jest.fn().mockReturnValue(noTool);
  const result = detectRotatedStudyObjects(pixels, { preferred: 2, next: 3 }, false, infer);
  expect(result.scores).toEqual(noTool);
  expect(infer).toHaveBeenCalledTimes(1);
});

test('회전 재검사의 추론 오류를 정상 점수로 숨기지 않는다', () => {
  const infer = jest
    .fn()
    .mockReturnValueOnce(noTool)
    .mockImplementationOnce(() => {
      throw new Error('model failed');
    });
  expect(() => detectRotatedStudyObjects(pixels, { preferred: 0, next: 1 }, true, infer)).toThrow(
    'model failed',
  );
});
