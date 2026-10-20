import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
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
});
