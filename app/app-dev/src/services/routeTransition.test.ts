import { createRouteTransitionShield } from './routeTransition';

test('화면 전환 후 350ms 동안 화면 터치를 막고 시간이 지나면 다시 허용한다', () => {
  jest.useFakeTimers();
  const setShielded = jest.fn();
  try {
    const shield = createRouteTransitionShield(setShielded);
    shield();
    expect(setShielded).toHaveBeenLastCalledWith(true);
    jest.advanceTimersByTime(100);
    expect(setShielded).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(250);
    expect(setShielded).toHaveBeenLastCalledWith(false);
  } finally {
    jest.useRealTimers();
  }
});
