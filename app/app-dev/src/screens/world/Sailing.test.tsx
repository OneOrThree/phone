import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Sailing } from '@/screens/world/WorldViews';
import { initialState } from '@/services/model';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// 출항 연출(GROMO-2362)이 붙어도 onArrive 계약은 그대로다 — 한 번만 도착한다.
describe('Sailing', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([false, true])('reduceMotion=%s 에서 onArrive 를 한 번만 부른다', async (reduce) => {
    const s = initialState(true);
    const state = { ...s, settings: { ...s.settings, reduceMotion: reduce } };
    const onArrive = jest.fn();
    await render(<Sailing state={state} destination="섬" duration={1900} onArrive={onArrive} />);
    // jest 의 Animated 는 duration 과 무관하게 한 프레임에 끝나므로 «정확한 시각»은 여기서 못 본다 — 1회만 본다
    await act(async () => jest.advanceTimersByTime(2100));
    expect(onArrive).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(5000));
    expect(onArrive).toHaveBeenCalledTimes(1);
  });
});
