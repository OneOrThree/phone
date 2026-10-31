import { maxSigmoid } from './palmScore';
import { focusDetection } from './focusDetection';
const no = { book: 0, laptop: 0, keyboard: 0 };
const book = { ...no, book: 0.5 };
const laptop = { ...no, laptop: 0.8 };
const keyboard = { ...no, keyboard: 0.7 };

test.each([book, laptop, keyboard])(
  '손과 어느 공부 도구든 같은 두 장에서 보여야 한다: %j',
  (object) => {
    expect(focusDetection([0.5, 0.9, 0], [object, object, no])).toBe('focused');
    expect(focusDetection([0.9, 0.9, 0.9], [no, no, no])).toBe('missingObject');
    expect(focusDetection([0, 0, 0], [object, object, object])).toBe('missingHand');
  },
);
test('각 모델의 별도 다수결 대신 동일 프레임의 결합 증거를 센다', () => {
  expect(focusDetection([0.9, 0.9, 0], [no, book, book])).toBe('missingObject');
  expect(focusDetection([0.9, 0.9, 0], [book, laptop, no])).toBe('focused');
});
test('2장만으로 성공시키지 않고 오류를 미검출·성공과 구분한다', () => {
  expect(focusDetection([1, 1], [book, book])).toBe('checking');
  expect(focusDetection(null, [])).toBe('unavailable');
  expect(focusDetection([1, 1, 1], [])).toBe('unavailable');
  expect(focusDetection([1, 1, 1], [null, null, null])).toBe('unavailable');
  expect(focusDetection([1, 1, 1], [book, null, no])).toBe('unavailable');
  expect(focusDetection([1, 1, 1], [book, book, null])).toBe('focused');
  expect(focusDetection([0, 0, 1], [null, null, null])).toBe('missingHand');
});

test('둘 다 부족하면 손 안내 하나를 먼저 보내고 손이 충족되면 도구 안내로 바뀐다', () => {
  expect(focusDetection([0, 0, 0], [no, no, no])).toBe('missingHand');
  expect(focusDetection([0.9, 0, 0], [no, no, no])).toBe('missingHand');
  expect(focusDetection([0.9, 0.9, 0], [no, no, no])).toBe('missingObject');
  expect(focusDetection([0.9, 0.9, 0], [book, book, no])).toBe('focused');
});

test.each([Infinity, -Infinity, NaN])(
  '비정상 손 출력 %s와 공부 도구 두 장으로 인증하지 않는다',
  (raw) => {
    const hand = maxSigmoid(new Float32Array([raw]));
    const book = { book: 0.9, laptop: 0, keyboard: 0 };
    expect(focusDetection([hand, hand, 0], [book, book, null])).toBe('unavailable');
  },
);
