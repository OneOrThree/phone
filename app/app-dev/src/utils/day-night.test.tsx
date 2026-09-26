import { act, renderHook } from '@testing-library/react-native';
import { dayNightAt, useDayNightState } from './day-night';

afterEach(() => {
  jest.useRealTimers();
});

test('낮·밤 경계 시각은 06시와 18시를 기준으로 한다', () => {
  expect(dayNightAt(new Date(2026, 8, 27, 5, 59))).toBe('night');
  expect(dayNightAt(new Date(2026, 8, 27, 6, 0))).toBe('day');
  expect(dayNightAt(new Date(2026, 8, 27, 17, 59))).toBe('day');
  expect(dayNightAt(new Date(2026, 8, 27, 18, 0))).toBe('night');
});

test('홈의 낮·밤 상태는 열린 화면에서도 경계 통과 후 갱신된다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 27, 17, 59));
  const { result } = await renderHook(() => useDayNightState());
  expect(result.current).toBe('day');

  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(result.current).toBe('night');
});

test('하위 월드맵은 상위 홈의 낮·밤 상태를 우선 사용한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 27, 17, 59));
  const { result, rerender } = await renderHook(
    ({ dayNight }: { dayNight: 'day' | 'night' }) => useDayNightState(dayNight),
    { initialProps: { dayNight: 'day' as const } },
  );
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(result.current).toBe('day');
  await rerender({ dayNight: 'night' });
  expect(result.current).toBe('night');
});
