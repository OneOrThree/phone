/** 화면이 바뀐 직후 같은 연타에서 다음 화면의 CTA가 눌리는 것을 막는다. */
export function createRouteTransitionGate(cooldownMs = 350) {
  let lastAcceptedAt = Number.NEGATIVE_INFINITY;

  return (navigate: () => void) => {
    const now = Date.now();
    if (now - lastAcceptedAt < cooldownMs) return false;
    lastAcceptedAt = now;
    navigate();
    return true;
  };
}
