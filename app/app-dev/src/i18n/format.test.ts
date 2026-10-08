import { hoursMinutes } from '@/services/model';
import { formatDuration } from './format';
import { applyLocalePref } from './index';

afterEach(() => applyLocalePref('system'));

// 교체 전 model.ts hoursMinutes 본문 그대로 — 지금의 hoursMinutes 는 formatDuration 을 부르므로
// 둘끼리만 비교하면 항등이라, 원래 규칙을 박제해 두고 둘 다 대조한다.
const before = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}분` : m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`;
};
const minutes = [0, 59, 60, 65, 120];

test('formatDuration — ko 는 0분·59분·1시간·1시간 5분·2시간', () => {
  expect(minutes.map((m) => formatDuration(m * 60))).toEqual([
    '0분',
    '59분',
    '1시간',
    '1시간 5분',
    '2시간',
  ]);
});

test('formatDuration — ko 출력이 기존 hoursMinutes 와 글자까지 같다', () => {
  for (const seconds of [0, 59, 60, 3599, 3600, 3660, 3900, 7200, 86399, 90061]) {
    expect(formatDuration(seconds)).toBe(before(seconds));
    expect(hoursMinutes(seconds)).toBe(before(seconds));
  }
});

// 입력 방어는 호출부 몫이다 — 음수·NaN·Infinity 도 기존 hoursMinutes 와 같은 글자를 내야 회귀가 없다.
test('formatDuration — 음수·NaN·Infinity 입력도 기존 hoursMinutes 와 같다', () => {
  expect([-30, NaN, Infinity].map(formatDuration)).toEqual(['-1분', 'NaN시간', 'Infinity시간']);
  for (const seconds of [-30, NaN, Infinity]) expect(formatDuration(seconds)).toBe(before(seconds));
});

test('formatDuration — en 은 m·h 단위', () => {
  applyLocalePref('en');
  expect(minutes.map((m) => formatDuration(m * 60))).toEqual(['0m', '59m', '1h', '1h 5m', '2h']);
});
