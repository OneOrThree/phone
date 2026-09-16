// sessionSaveVerdict.ts 유닛 테스트(GROMO-948) — 모듈 스코프 상태(현재 판정·리스너)를 갖는
// pub/sub이라 매 테스트 jest.resetModules()로 새 모듈 인스턴스를 받아 상태를 리셋한다.
// 판정 날짜는 todayStr() 기반이므로 fake timers로 '오늘'을 고정하고, 자정 넘김은 시계 이동으로 재현.
import type { FocusSessionSaveResponse } from '@/types/dto/focus';

type VerdictModule = typeof import('./sessionSaveVerdict');

const NOW = new Date('2026-07-15T22:00:00+09:00');

let mod: VerdictModule;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.resetModules(); // current·listeners 초기화 — 테스트 간 판정 잔존 방지
  mod = jest.requireActual<VerdictModule>('./sessionSaveVerdict');
});

afterEach(() => {
  jest.useRealTimers();
});

function res(dayTotalFocusSeconds: number, streakQualifiedToday = true): FocusSessionSaveResponse {
  return { dayTotalFocusSeconds, streakQualifiedToday };
}

describe('발행 → 구독 전달', () => {
  test('발행 전 스냅샷은 null이다', () => {
    expect(mod.getSessionSaveVerdict()).toBeNull();
  });

  test('발행하면 구독자가 호출되고 스냅샷에 수신 날짜가 찍힌다', () => {
    const listener = jest.fn();
    mod.subscribeSessionSaveVerdict(listener);
    mod.publishSessionSaveVerdict(res(600));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mod.getSessionSaveVerdict()).toEqual({
      date: '2026-07-15',
      dayTotalFocusSeconds: 600,
      streakQualifiedToday: true,
    });
  });

  test('구독 해제 후에는 호출되지 않는다', () => {
    const listener = jest.fn();
    const unsubscribe = mod.subscribeSessionSaveVerdict(listener);
    unsubscribe();
    mod.publishSessionSaveVerdict(res(600));
    expect(listener).not.toHaveBeenCalled();
  });

  test('발행이 없으면 스냅샷은 같은 참조를 유지한다 — useSyncExternalStore 요건', () => {
    mod.publishSessionSaveVerdict(res(600));
    expect(mod.getSessionSaveVerdict()).toBe(mod.getSessionSaveVerdict());
  });
});

describe('구버전 백엔드(빈 바디 201) 방어', () => {
  test('판정 필드가 없거나 타입이 다르면 발행하지 않는다', () => {
    const listener = jest.fn();
    mod.subscribeSessionSaveVerdict(listener);
    mod.publishSessionSaveVerdict(undefined as unknown as FocusSessionSaveResponse);
    mod.publishSessionSaveVerdict({} as FocusSessionSaveResponse);
    mod.publishSessionSaveVerdict({ dayTotalFocusSeconds: 600 } as FocusSessionSaveResponse);
    mod.publishSessionSaveVerdict({
      dayTotalFocusSeconds: '600',
      streakQualifiedToday: true,
    } as unknown as FocusSessionSaveResponse);
    expect(listener).not.toHaveBeenCalled();
    expect(mod.getSessionSaveVerdict()).toBeNull();
  });
});

describe('같은 날 순서 없는 도착(뽀모도로 블록별 업로드)', () => {
  test('늦게 도착한 이전 블록 응답(누적이 작음)이 최신 판정을 덮지 않는다', () => {
    const listener = jest.fn();
    mod.subscribeSessionSaveVerdict(listener);
    mod.publishSessionSaveVerdict(res(1200, true));
    mod.publishSessionSaveVerdict(res(600, false)); // 이전 블록 응답이 나중에 도착
    expect(listener).toHaveBeenCalledTimes(1); // 무시된 발행은 알림도 없다
    expect(mod.getSessionSaveVerdict()).toEqual({
      date: '2026-07-15',
      dayTotalFocusSeconds: 1200,
      streakQualifiedToday: true,
    });
  });

  test('누적이 같으면 무시, 더 크면 갱신한다', () => {
    mod.publishSessionSaveVerdict(res(600, false));
    const first = mod.getSessionSaveVerdict();
    mod.publishSessionSaveVerdict(res(600, false));
    expect(mod.getSessionSaveVerdict()).toBe(first); // 같은 값은 참조까지 그대로
    mod.publishSessionSaveVerdict(res(900, true));
    expect(mod.getSessionSaveVerdict()).toEqual({
      date: '2026-07-15',
      dayTotalFocusSeconds: 900,
      streakQualifiedToday: true,
    });
  });
});

describe('자정 넘김', () => {
  test('잔존 판정의 date는 발행 시점 날짜다 — 다음 날 소비처가 todayStr()와 대조해 걸러낸다', () => {
    mod.publishSessionSaveVerdict(res(600));
    jest.setSystemTime(new Date('2026-07-16T00:10:00+09:00'));
    // 판정 자체는 남아 있지만 date가 어제라, 소비처 계약(date === todayStr())에 걸리지 않는다
    expect(mod.getSessionSaveVerdict()?.date).toBe('2026-07-15');
  });

  test('날짜가 바뀌면 누적이 더 작아도 새 판정으로 교체된다', () => {
    mod.publishSessionSaveVerdict(res(3600, true));
    jest.setSystemTime(new Date('2026-07-16T00:10:00+09:00'));
    mod.publishSessionSaveVerdict(res(300, false)); // 새 날 첫 세션 — 단조증가 비교는 같은 날에만 적용
    expect(mod.getSessionSaveVerdict()).toEqual({
      date: '2026-07-16',
      dayTotalFocusSeconds: 300,
      streakQualifiedToday: false,
    });
  });
});

// 판정 발행 게이트(GROMO-1252 코드리뷰 4차 ④) — 서버는 endedAt이 아니라 분포 맵의 마지막
// 비어있지 않은 날짜로 판정한다. 자정 전에 집중하고 자정을 넘겨 일시정지한 뒤 tick 없이
// 종료하면 맵엔 전날만 담기는데 endedAt은 오늘이라, endedAt 게이트는 어제 판정을 오늘 것으로
// 발행해 버렸다(큰 어제 누적이 단조 가드에 걸려 이후 오늘 응답까지 막는다).
describe('발행 게이트 — 귀속된 맵 날짜 기준', () => {
  const TODAY = '2026-07-15';
  const YESTERDAY = '2026-07-14';
  const endedAtToday = new Date('2026-07-15T22:00:00+09:00').toISOString();

  test('맵에 전날만 있으면 endedAt이 오늘이어도 오늘 판정이 아니다', () => {
    expect(mod.isTodayVerdict({ [YESTERDAY]: 1800 }, endedAtToday)).toBe(false);

    // 게이트를 통과하지 못하므로 판정이 발행되지 않는다(소비처는 추정 판정 폴백 유지).
    if (mod.isTodayVerdict({ [YESTERDAY]: 1800 }, endedAtToday)) {
      mod.publishSessionSaveVerdict(res(1800));
    }
    expect(mod.getSessionSaveVerdict()).toBeNull();
  });

  test('맵의 마지막 날짜가 오늘이면 발행한다(자정 걸친 세션도 오늘 조각이 있으면 오늘 판정)', () => {
    expect(mod.isTodayVerdict({ [YESTERDAY]: 300, [TODAY]: 300 }, endedAtToday)).toBe(true);
  });

  test('맵이 없으면(구버전 경로·tick 0 — 서버 벽시계 폴백) 종전대로 endedAt 기준', () => {
    const endedAtYesterday = new Date('2026-07-14T23:50:00+09:00').toISOString();
    expect(mod.isTodayVerdict(undefined, endedAtToday)).toBe(true);
    expect(mod.isTodayVerdict(undefined, endedAtYesterday)).toBe(false);
    expect(mod.isTodayVerdict({}, endedAtYesterday)).toBe(false);
  });
});
