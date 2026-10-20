import React from 'react';
import { Animated, AppState, type AppStateStatus } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { Sailing, voyageTable } from '@/screens/world/WorldViews';
import { initialState } from '@/services/model';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const stateWith = (reduce: boolean) => {
  const s = initialState(true);
  return { ...s, settings: { ...s.settings, reduceMotion: reduce } };
};

// 출항 연출(GROMO-2362)이 붙어도 onArrive 계약은 그대로다 — 한 번만 도착한다.
describe('Sailing', () => {
  let emit: (s: AppStateStatus) => void;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      emit = handler as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as any;
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  const cycle = async () => {
    await act(async () => emit('background'));
    await act(async () => emit('active'));
  };

  it.each([false, true])('reduceMotion=%s 에서 onArrive 를 한 번만 부른다', async (reduce) => {
    const onArrive = jest.fn();
    await render(
      <Sailing state={stateWith(reduce)} destination="섬" duration={1900} onArrive={onArrive} />,
    );
    // jest 의 Animated 는 duration 과 무관하게 한 프레임에 끝나므로 «정확한 시각»은 여기서 못 본다 — 1회만 본다
    await act(async () => jest.advanceTimersByTime(2100));
    expect(onArrive).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(5000));
    expect(onArrive).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'reduceMotion=%s — 도착 뒤 background→active 에도 다시 부르지 않는다',
    async (reduce) => {
      const onArrive = jest.fn();
      await render(
        <Sailing state={stateWith(reduce)} destination="섬" duration={1900} onArrive={onArrive} />,
      );
      await act(async () => jest.advanceTimersByTime(2100));
      expect(onArrive).toHaveBeenCalledTimes(1);
      await cycle();
      await act(async () => jest.advanceTimersByTime(2100));
      expect(onArrive).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    'reduceMotion=%s — 도착 전 background→active 뒤 이어 가서 한 번 부른다',
    async (reduce) => {
      const onArrive = jest.fn();
      await render(
        <Sailing state={stateWith(reduce)} destination="섬" duration={1900} onArrive={onArrive} />,
      );
      await cycle();
      await act(async () => jest.advanceTimersByTime(2100));
      expect(onArrive).toHaveBeenCalledTimes(1);
    },
  );

  // 항적 앞 끝이 선미 끝(LAB −300, 뒤 판 불투명 경계) 뒤에 있어야 뗏목에 가리지 않는다
  it.each([1.9, 7])('%s초 — 항적은 늘 선미 끝 뒤 물 위에서 시작한다', (sec) => {
    for (const w of voyageTable(sec).wake) {
      w.x.forEach((x, i) => expect(x + w.len[i] / 2).toBeLessThanOrEqual(-300 + 1e-9));
    }
  });

  // jest 의 Animated 는 한 프레임에 끝나 «남은 시간 뒤 도착»은 못 본다 — 대신 재개 때 만든 timing 의 duration(= 총 − 경과)을 본다.
  // 장면의 다른 반복 모션 timing 과 섞이므로 다른 값과 겹치지 않는 2300 → 1400 으로 가른다
  it('도착 전 background→active — 경과 시간이 누적돼 남은 시간만 이어 간다', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const durations = () => timing.mock.calls.map((c) => c[1].duration);
    await render(
      <Sailing state={stateWith(false)} destination="섬" duration={2300} onArrive={jest.fn()} />,
    );
    expect(durations()).toContain(2300);
    expect(durations()).not.toContain(1400);
    await act(async () => jest.advanceTimersByTime(900));
    await cycle();
    expect(durations()).toContain(1400);
  });

  it.each([false, true])(
    'reduceMotion=%s — duration 이 바뀌면 도착을 리셋해 새 이동 끝에서 다시 한 번 부른다',
    async (reduce) => {
      const onArrive = jest.fn();
      const ui = (d: number) => (
        <Sailing state={stateWith(reduce)} destination="섬" duration={d} onArrive={onArrive} />
      );
      const view = await render(ui(1900));
      await act(async () => jest.advanceTimersByTime(2100));
      expect(onArrive).toHaveBeenCalledTimes(1);
      await view.rerender(ui(1200));
      await act(async () => jest.advanceTimersByTime(1400));
      expect(onArrive).toHaveBeenCalledTimes(2);
    },
  );

  it.each([0, 0.5, 1, 1.9, 7])(
    'voyageTable(%s) — 표본이 유한하고 시작 −150·끝 150, 끝에서 잔흔들림 0',
    (sec) => {
      const tr = voyageTable(sec);
      for (const v of Object.values(tr).flat()) {
        for (const n of typeof v === 'object' && !Array.isArray(v)
          ? Object.values(v).flat()
          : [v].flat()) {
          expect(Number.isFinite(n)).toBe(true);
        }
      }
      expect(tr.x[0]).toBeCloseTo(-150, 9);
      expect(tr.x.at(-1)).toBeCloseTo(150, 9);
      // 끝: 속도 0 이라 lag = settle*0.025 → settle 이 접혀 0 이어야 lag 도 0
      expect(tr.lag.at(-1)).toBeCloseTo(0, 9);
    },
  );
});
