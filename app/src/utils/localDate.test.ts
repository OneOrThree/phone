// localDate.ts 유닛 테스트(GROMO-945) — 로컬 날짜 문자열의 월말·연말·윤년 경계.
// todayStr/tomorrowStr/yesterdayStr가 new Date()를 쓰므로 fake timers로 '오늘'을 고정한다.
// 시간대는 jest.config.js에서 Asia/Seoul 고정.
import {
  kstDateStr,
  kstLocalSameDay,
  localDateStr,
  todayStr,
  todayStrKst,
  tomorrowStr,
  tomorrowStrKst,
  yesterdayStr,
  yesterdayStrKst,
} from './localDate';

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

// KST 고정 버전(내기 bet_date용 — 서버가 KST로 판정하므로 기기 로컬과 분리) —
// jest 타임존이 Asia/Seoul 고정이라 로컬 버전과 같은 값이어야 하고, 핵심은 UTC와
// 날짜가 갈리는 시각(KST 자정 직후)에도 KST 날짜를 돌려주는 경계다.
describe('todayStrKst / tomorrowStrKst', () => {
  test('고정된 오늘 기준 — KST 환경에선 로컬 버전과 같다', () => {
    expect(todayStrKst()).toBe('2026-07-15');
    expect(tomorrowStrKst()).toBe('2026-07-16');
  });

  test('KST 자정 직후 — UTC 기준이면 전날인 시각에도 KST 날짜다', () => {
    // KST 00:30 = UTC 전날 15:30 — bet_date가 하루 밀리면 서버가 BET_CLOSED로 거절한다.
    jest.setSystemTime(new Date('2026-07-16T00:30:00+09:00'));
    expect(todayStrKst()).toBe('2026-07-16');
    expect(tomorrowStrKst()).toBe('2026-07-17');
  });

  test('월말·연말 경계를 넘는다', () => {
    jest.setSystemTime(new Date('2026-07-31T09:00:00+09:00'));
    expect(tomorrowStrKst()).toBe('2026-08-01');
    jest.setSystemTime(new Date('2026-12-31T09:00:00+09:00'));
    expect(tomorrowStrKst()).toBe('2027-01-01');
  });
});

// GROMO-1219에서 추가된 KST 짝 — 어제(yesterdayStrKst)와 임의 Date 포맷(kstDateStr).
describe('yesterdayStrKst / kstDateStr', () => {
  test('고정된 오늘 기준 — KST 환경에선 로컬 버전과 같다', () => {
    expect(yesterdayStrKst()).toBe('2026-07-14');
    expect(kstDateStr(NOW)).toBe('2026-07-15');
  });

  test('KST 자정 직후 — UTC 기준이면 전날인 시각에도 KST 어제다', () => {
    // KST 00:30 = UTC 전날 15:30 — UTC 축이면 어제가 이틀 전으로 밀린다.
    jest.setSystemTime(new Date('2026-07-16T00:30:00+09:00'));
    expect(yesterdayStrKst()).toBe('2026-07-15');
  });

  test('kstDateStr — KST 자정 직후 Date는 UTC로는 전날이지만 KST 날짜를 돌려준다', () => {
    // 2026-07-15T15:30:00Z = KST 2026-07-16 00:30 — toISOString 축이면 전날이 된다.
    expect(kstDateStr(new Date('2026-07-15T15:30:00Z'))).toBe('2026-07-16');
    expect(kstDateStr(new Date('2026-07-16T00:30:00+09:00'))).toBe('2026-07-16');
  });

  test('월초·연초의 어제는 이전 달·이전 해다', () => {
    jest.setSystemTime(new Date('2026-08-01T09:00:00+09:00'));
    expect(yesterdayStrKst()).toBe('2026-07-31');
    jest.setSystemTime(new Date('2026-01-01T09:00:00+09:00'));
    expect(yesterdayStrKst()).toBe('2025-12-31');
  });
});

// 병합 동축 게이트(GROMO-1236 P2 6라운드) — 러너 TZ가 Asia/Seoul 고정이라 false 분기(비KST
// 기기)는 값으로 재현할 수 없다: 여기서는 정의(todayStrKst===todayStr)와 KST 자정 경계에서의
// 안정성만 잠근다. 소비처의 축 자체는 각 화면의 게이트 주석 + celebrationDayKey 축 테스트가 담당.
describe('kstLocalSameDay', () => {
  test('KST 러너에선 항상 true — 정의상 todayStrKst()===todayStr()와 일치한다', () => {
    expect(kstLocalSameDay()).toBe(true);
    expect(kstLocalSameDay()).toBe(todayStrKst() === todayStr());
  });

  test('KST 자정 직후(UTC 전날 시각)에도 두 축이 같이 넘어가 true', () => {
    jest.setSystemTime(new Date('2026-07-16T00:30:00+09:00'));
    expect(kstLocalSameDay()).toBe(true);
  });
});
