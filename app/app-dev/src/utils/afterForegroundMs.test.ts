import { AppState, type AppStateStatus } from 'react-native';
import { afterForegroundMs } from './afterForegroundMs';

let listeners: Set<(state: AppStateStatus) => void>;
const originalState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers();
  listeners = new Set();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  AppState.currentState = originalState;
});

function change(state: AppStateStatus) {
  AppState.currentState = state;
  listeners.forEach((listener) => listener(state));
}

test('백그라운드 시간은 빼고 남은 연출 시간만 실행한다', () => {
  const done = jest.fn();
  afterForegroundMs(done, 2000);
  jest.advanceTimersByTime(700);
  change('inactive');
  change('background');
  jest.advanceTimersByTime(60_000);
  expect(done).not.toHaveBeenCalled();
  change('active');
  change('active');
  jest.advanceTimersByTime(1299);
  expect(done).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(done).toHaveBeenCalledTimes(1);
  expect(listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

test('백그라운드에서 예약하면 복귀한 뒤부터 시간을 센다', () => {
  change('background');
  const done = jest.fn();
  afterForegroundMs(done, 2000);
  jest.advanceTimersByTime(5000);
  expect(jest.getTimerCount()).toBe(0);
  change('active');
  jest.advanceTimersByTime(2000);
  expect(done).toHaveBeenCalledTimes(1);
});

test('반복 진입·이탈 10회 뒤 구독과 타이머가 남지 않는다', () => {
  const done = jest.fn();
  for (let i = 0; i < 10; i++) {
    const cancel = afterForegroundMs(done, 2000);
    jest.advanceTimersByTime(100);
    change('background');
    cancel();
    cancel();
    change('active');
    expect(listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  }
  jest.advanceTimersByTime(10_000);
  expect(done).not.toHaveBeenCalled();
});
