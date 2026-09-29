import type { Route, State } from '@/services/model';

// 세션이 정본이다. 이동 연출 중에는 단계를 바꾸지 않고 도착한 화면에서만 맞춘다.
export function reconcileTutorial(state: State, route: Route, restoring = false): number {
  const progress = state.tutorial;
  if (!progress || progress.step >= 22) return progress?.step ?? 0;
  const step = progress.step;
  const session = state.session;
  if (route === 'focus' || route === 'rest') {
    if (!session) return step;
    if (progress.sessionId && progress.sessionId !== session.id) return 99;
    if (route === 'rest' && session.status === 'paused') return 15;
    if (route === 'focus' && session.status === 'active') {
      if (step <= 8) return 9;
      if (step === 15) return 16;
      if ((restoring && step === 18) || step >= 19) return 17;
    }
  }
  if (route === 'focusResult' && state.lastResult) {
    if (progress.sessionId && progress.sessionId !== state.lastResult.id) return 99;
    return step < 19 ? 19 : step;
  }
  if (restoring && route === 'home' && !session && step >= 5) return 4;
  if (restoring && route === 'home' && step <= 3) return 0;
  return step;
}
