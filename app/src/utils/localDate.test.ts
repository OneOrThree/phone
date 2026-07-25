// localDate.ts 유닛 테스트(GROMO-945) — 로컬 날짜 문자열의 월말·연말·윤년 경계.
// todayStr/tomorrowStr/yesterdayStr가 new Date()를 쓰므로 fake timers로 '오늘'을 고정한다.
// 시간대는 jest.config.js에서 Asia/Seoul 고정.
import { localDateStr, todayStr, tomorrowStr, yesterdayStr } from './localDate';

const NOW = new Date('2026-07-15T09:00:00+09:00');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.setSystemTime(NOW); // 시계를 옮긴 테스트가 있어도 기본 '오늘'로 복귀
});

afterAll(() => {
  jest.useRealTimers();
});

describe('localDateStr', () => {
  test('월·일 한 자리는 0패딩한다', () => {
    expect(localDateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('자정 직후에도 로컬 날짜 기준이다 — UTC(toISOString) 기준이면 전날로 밀리는 시각', () => {
    // KST 00:30 = UTC 전날 15:30 — 이 함수의 존재 이유(주석의 KST 하루 어긋남 방지)
    expect(localDateStr(new Date('2026-07-16T00:30:00+09:00'))).toBe('2026-07-16');
  });
});

describe('todayStr / tomorrowStr / yesterdayStr', () => {
  test('고정된 오늘 기준 3형제', () => {
    expect(todayStr()).toBe('2026-07-15');
    expect(tomorrowStr()).toBe('2026-07-16');
    expect(yesterdayStr()).toBe('2026-07-14');
  });

  test('월말 → 다음 달 1일로 넘어간다 (7/31 → 8/1)', () => {
    jest.setSystemTime(new Date('2026-07-31T09:00:00+09:00'));
    expect(tomorrowStr()).toBe('2026-08-01');
  });

  test('연말 → 다음 해 1/1로 넘어간다 (12/31 → 1/1)', () => {
    jest.setSystemTime(new Date('2026-12-31T09:00:00+09:00'));
    expect(tomorrowStr()).toBe('2027-01-01');
  });

  test('월초·연초의 어제는 이전 달·이전 해다', () => {
    jest.setSystemTime(new Date('2026-08-01T09:00:00+09:00'));
    expect(yesterdayStr()).toBe('2026-07-31');
    jest.setSystemTime(new Date('2026-01-01T09:00:00+09:00'));
    expect(yesterdayStr()).toBe('2025-12-31');
  });

  test('윤년 3/1의 어제는 2/29다', () => {
    jest.setSystemTime(new Date('2024-03-01T09:00:00+09:00'));
    expect(yesterdayStr()).toBe('2024-02-29');
  });
});
