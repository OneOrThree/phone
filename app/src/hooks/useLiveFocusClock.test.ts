// 공용 시계 — 구독자가 몇이든 타이머는 **하나**여야 한다(GROMO-1572).
// 리그 랭킹은 집중 중인 행마다 이 훅을 부르므로(RankRow → LiveFocusTime), 훅마다 인터벌을
// 만들면 봇 190명(티켓 1565) 이후 최대 100개가 동시에 돈다.
import { act, renderHook } from '@testing-library/react-native';
import { useLiveFocusClock } from './useLiveFocusClock';

// 시계가 만든 인터벌만 센다 — RNTL 내부 타이머와 섞이지 않게 setInterval 호출을 직접 본다.
function intervalSpies() {
  return {
    set: jest.spyOn(global, 'setInterval'),
    clear: jest.spyOn(global, 'clearInterval'),
  };
}

describe('useLiveFocusClock', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('active=false 면 구독하지 않는다 — 인터벌도 값 갱신도 없다', async () => {
    const spy = intervalSpies();
    const { result, unmount } = await renderHook(() => useLiveFocusClock(false));
    const before = result.current;

    expect(spy.set).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(3000));
    expect(result.current).toBe(before);

    await unmount();
  });

  it('구독자가 여럿이어도 인터벌은 하나고, 전부 빠지면 멈춘다', async () => {
    const spy = intervalSpies();
    const a = await renderHook(() => useLiveFocusClock(true));
    const b = await renderHook(() => useLiveFocusClock(true));
    const c = await renderHook(() => useLiveFocusClock(true));

    expect(spy.set).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(1000));
    // 같은 시계를 보므로 값도 같다 — 행마다 제각각 흐르면 같은 목록의 초가 어긋난다.
    expect(a.result.current).toBe(b.result.current);
    expect(b.result.current).toBe(c.result.current);

    await a.unmount();
    await b.unmount();
    expect(spy.clear).not.toHaveBeenCalled(); // c 가 남아 있는 동안은 계속 돈다

    await c.unmount();
    expect(spy.clear).toHaveBeenCalledTimes(1);
  });

  // 늦게 붙는 구독자가 제 시각(Date.now())을 따로 읽으면 다음 틱까지 최대 1초 동안 같은 목록의
  // 행끼리 라이브 시간이 어긋난다(코덱스 리뷰). ⚠️ 틱 경계에서 검사하면 Date.now() 와 공유값이
  // 우연히 같아 통과해버리므로, **틱 사이(500ms)** 에서 붙여야 회귀를 잡는다.
  it('돌고 있는 시계에 늦게 붙어도 기존 구독자와 같은 값을 본다', async () => {
    const running = await renderHook(() => useLiveFocusClock(true));
    await act(async () => jest.advanceTimersByTime(1000)); // 틱 1회
    await act(async () => jest.advanceTimersByTime(500)); // 틱과 틱 사이로 이동

    const late = await renderHook(() => useLiveFocusClock(true));
    expect(late.result.current).toBe(running.result.current);

    await running.unmount();
    await late.unmount();
  });

  it('시계가 멈춰 있었으면 다시 붙을 때 현재 시각으로 올라간다 — 값이 밀리지 않는다', async () => {
    const first = await renderHook(() => useLiveFocusClock(true));
    const stale = first.result.current;
    await first.unmount(); // 구독자 0 → 시계 정지

    await act(async () => jest.advanceTimersByTime(5000)); // 멈춰 있는 동안 시간이 흐름

    const revived = await renderHook(() => useLiveFocusClock(true));
    expect(revived.result.current).toBe(stale + 5000);

    await revived.unmount();
  });
});
