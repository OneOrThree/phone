import { AppState, type AppStateStatus } from 'react-native';
import { subscribeForegroundClock } from './foregroundClock';

let listeners: Set<(state: AppStateStatus) => void>;
const original = AppState.currentState;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  AppState.currentState = 'active';
  listeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  AppState.currentState = original;
});
function change(state: AppStateStatus) {
  AppState.currentState = state;
  listeners.forEach((listener) => listener(state));
}
test('벽시계 경계에 맞추고 배경 1분 동안은 호출·예약이 없다', () => {
  jest.setSystemTime(250);
  const tick = jest.fn();
  const cancel = subscribeForegroundClock(tick, 1000);
  jest.advanceTimersByTime(749);
  expect(tick).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(tick).toHaveBeenLastCalledWith(1000);
  change('inactive');
  change('background');
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(60_250);
  expect(tick).toHaveBeenCalledTimes(1);
  change('active');
  change('active');
  expect(tick).toHaveBeenLastCalledWith(61_250);
  expect(tick).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(750);
  expect(tick).toHaveBeenLastCalledWith(62_000);
  cancel();
  expect(jest.getTimerCount()).toBe(0);
  expect(listeners.size).toBe(0);
});
test('배경에서 마운트해도 복귀까지 쉬고 10회 진입·이탈 뒤 자원이 남지 않는다', () => {
  const tick = jest.fn();
  for (let i = 0; i < 10; i++) {
    change('background');
    const cancel = subscribeForegroundClock(tick, 1000);
    expect(jest.getTimerCount()).toBe(0);
    change('active');
    expect(jest.getTimerCount()).toBe(1);
    cancel();
    cancel();
    expect(listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  }
  expect(tick).toHaveBeenCalledTimes(10);
});
test('콜백 안에서 해제해도 다음 예약을 만들지 않는다', () => {
  const tick = jest.fn(() => cancel());
  const cancel = subscribeForegroundClock(tick, 1000);
  jest.advanceTimersByTime(10_000);
  expect(tick).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  expect(listeners.size).toBe(0);
});
