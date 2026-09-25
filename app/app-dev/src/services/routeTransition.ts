/** 화면 전환 직후 짧은 시간 동안 화면을 덮어 후속 터치가 새 화면에 닿지 않게 한다. */
export function createRouteTransitionShield(
  setShielded: (shielded: boolean) => void,
  durationMs = 350,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return () => {
    if (timer) clearTimeout(timer);
    setShielded(true);
    timer = setTimeout(() => {
      timer = null;
      setShielded(false);
    }, durationMs);
  };
}

export function createShieldedRouteTransition<T>(
  setShielded: (shielded: boolean) => void,
  setRoute: (route: T) => void,
  durationMs = 350,
) {
  const shield = createRouteTransitionShield(setShielded, durationMs);
  return (route: T) => {
    shield();
    setRoute(route);
  };
}
