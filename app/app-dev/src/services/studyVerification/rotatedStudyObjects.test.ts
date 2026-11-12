import {
  detectRotatedHand,
  detectRotatedStudyObjects,
  objectAttemptLimit,
  rotatePalmRgb,
  rotateSquareRgb,
} from './rotatedStudyObjects';
import { focusDetection } from './focusDetection';
import { PALM_INPUT } from './palmScore';
import { OBJECT_INPUT } from './studyObjects';

const noTool = { book: 0.1, laptop: 0.1, keyboard: 0.1 };
const book = { ...noTool, book: 0.45 };
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

test('도구를 찾으면 그 방향을 기억하고 다음 프레임은 그 방향 한 번으로 끝낸다', () => {
  const infer = jest.fn().mockReturnValueOnce(noTool).mockReturnValue(book);
  const first = detectRotatedStudyObjects(pixels, { preferred: 0, next: 1 }, true, infer);
  expect(infer).toHaveBeenCalledTimes(2);
  expect(first).toEqual({ scores: book, search: { preferred: 1, next: 2 }, attempts: 2 });
  infer.mockClear();
  expect(detectRotatedStudyObjects(pixels, first.search, true, infer).scores).toEqual(book);
  expect(infer).toHaveBeenCalledTimes(1);
});

test('한 프레임에서 최대 네 방향까지 보고 못 찾으면 가장 높은 점수를 남긴다', () => {
  const near = { ...noTool, book: 0.3 };
  const infer = jest
    .fn()
    .mockReturnValueOnce(noTool)
    .mockReturnValueOnce(near)
    .mockReturnValue(noTool);
  const result = detectRotatedStudyObjects(pixels, { preferred: 0, next: 1 }, true, infer);
  expect(infer).toHaveBeenCalledTimes(4);
  expect(result).toEqual({ scores: near, search: { preferred: 0, next: 0 }, attempts: 4 });
});

test('주기 검사는 첫 장에서 네 방향을 보고 뒤의 두 장은 새 추론으로 확인한다', () => {
  let search = { preferred: 0, next: 1 };
  let used = 0;
  const infer = jest
    .fn()
    .mockReturnValueOnce(noTool)
    .mockReturnValueOnce(noTool)
    .mockReturnValueOnce(noTool)
    .mockReturnValue(book);
  const scores = [];
  for (let i = 0; i < 3; i++) {
    const r = detectRotatedStudyObjects(pixels, search, true, infer, objectAttemptLimit(i, used));
    used += r.attempts;
    search = r.search;
    scores.push(r.scores);
  }
  expect(used).toBe(6);
  expect(search.preferred).toBe(3);
  expect(focusDetection([0.8, 0.8, 0.8], scores)).toBe('focused');
});

test('계속 못 찾아도 3장 묶음의 도구 추론은 6회를 넘기지 않는다', () => {
  let used = 0;
  let search = { preferred: 0, next: 1 };
  const infer = jest.fn(() => noTool);
  for (let i = 0; i < 3; i++) {
    const r = detectRotatedStudyObjects(pixels, search, true, infer, objectAttemptLimit(i, used));
    used += r.attempts;
    search = r.search;
  }
  expect(used).toBe(6);
  expect(infer).toHaveBeenCalledTimes(6);
  expect(() => objectAttemptLimit(3, 0)).toThrow('Invalid inference budget');
});

test('한 방향만 본 장은 다음에 볼 방향 순서를 처음으로 되돌리지 않는다', () => {
  const infer = jest.fn().mockReturnValue(noTool);
  expect(detectRotatedStudyObjects(pixels, { preferred: 0, next: 3 }, false, infer).search).toEqual(
    {
      preferred: 0,
      next: 3,
    },
  );
  expect(
    detectRotatedStudyObjects(pixels, { preferred: 0, next: 3 }, true, infer, 1).search,
  ).toEqual({ preferred: 0, next: 3 });
});

test('손이 없는 프레임에는 추가 추론을 하지 않고 이전 성공 점수도 재사용하지 않는다', () => {
  const infer = jest.fn().mockReturnValue(noTool);
  const result = detectRotatedStudyObjects(pixels, { preferred: 2, next: 3 }, false, infer);
  expect(result.scores).toEqual(noTool);
  expect(infer).toHaveBeenCalledTimes(1);
});

test('한 장의 여러 회전 결과를 여러 프레임으로 세지 않는다', () => {
  expect(focusDetection([0.9, 0.9, 0.9], [book, noTool, noTool])).toBe('missingObject');
  expect(focusDetection([0.9, 0.1, 0.9], [noTool, book, book])).toBe('missingObject');
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

test('손 입력 회전은 float32 비트를 보존하고 손 재검사는 최대 두 번이다', () => {
  const palm = new Float32Array(PALM_INPUT * PALM_INPUT * 3);
  for (let i = 0; i < palm.length; i++) palm[i] = i / palm.length;
  expect(new Float32Array(rotatePalmRgb(rotatePalmRgb(palm.buffer, 1), 3))).toEqual(palm);
  const infer = jest.fn().mockReturnValueOnce(0.2).mockReturnValue(0.6);
  const found = detectRotatedHand(palm.buffer, { preferred: 0, next: 1 }, infer);
  expect(found).toEqual({ score: 0.6, search: { preferred: 1, next: 2 }, attempts: 2 });
  expect(infer).toHaveBeenCalledTimes(2);
  infer.mockClear();
  expect(detectRotatedHand(palm.buffer, found.search, infer).attempts).toBe(1);
  expect(() => detectRotatedHand(palm.buffer, found.search, () => NaN)).toThrow(
    'Invalid palm score',
  );
});
