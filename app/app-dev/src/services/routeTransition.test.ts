import { createRouteTransitionGate } from './routeTransition';

test('화면 전환 직후 100ms 안에 도착한 후속 탭은 다음 화면의 CTA를 실행하지 않는다', () => {
  jest.useFakeTimers();
  const gate = createRouteTransitionGate();
  const routes: string[] = [];
  try {
    expect(gate(() => routes.push('character'))).toBe(true);
    jest.advanceTimersByTime(100);
    expect(gate(() => routes.push('chooseIsland'))).toBe(false);
    expect(routes).toEqual(['character']);

    jest.advanceTimersByTime(250);
    expect(gate(() => routes.push('chooseIsland'))).toBe(true);
    expect(routes).toEqual(['character', 'chooseIsland']);
  } finally {
    jest.useRealTimers();
  }
});
