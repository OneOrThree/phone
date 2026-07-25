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
