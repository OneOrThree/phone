import { createRouteTransitionShield, createShieldedRouteTransition } from './routeTransition';

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

test('공통 경로 전환은 경로를 바꾸기 전에 입력 차단을 시작한다', () => {
  jest.useFakeTimers();
  const calls: string[] = [];
  try {
    const transition = createShieldedRouteTransition(
      (shielded) => calls.push(`shield:${shielded}`),
      (route: string) => calls.push(`route:${route}`),
    );

    transition('home');

    expect(calls).toEqual(['shield:true', 'route:home']);
    jest.advanceTimersByTime(350);
    expect(calls).toEqual(['shield:true', 'route:home', 'shield:false']);
  } finally {
    jest.useRealTimers();
  }
});
