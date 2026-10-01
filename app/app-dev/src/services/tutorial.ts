import type { Route, State } from '@/services/model';
import { landPath, onLand, type Grid, type Point } from '@/utils/world-grid';

// 접근성 조작도 실제 지도·점유·물고기 배치·보행 조건을 통과한 자리만 선택한다.
export function findReachableTutorialSpot(
  grid: Grid,
  from: Point,
  preferred: Point,
  available: (point: Point) => boolean,
): Point | null {
  const candidates = [preferred];
  for (let index = 0; index < grid.cells.length; index++) {
    if (grid.cells[index] !== '1') continue;
    candidates.push({
      x: (((index % grid.cols) + 0.5) * grid.w) / grid.cols,
      y: ((Math.floor(index / grid.cols) + 0.5) * grid.h) / grid.rows,
    });
  }
  return (
    candidates.find(
      (point) => onLand(grid, point) && available(point) && landPath(grid, from, point).length > 0,
    ) ?? null
  );
}

// 세션이 정본이다. 이동 연출 중에는 단계를 바꾸지 않고 도착한 화면에서만 맞춘다.
export function reconcileTutorial(state: State, route: Route, restoring = false): number {
  const progress = state.tutorial;
  if (!progress || progress.step >= 22) return progress?.step ?? 0;
  const step = progress.step;
  const session = state.session ?? state.tutorialExperience?.session;
  const result = state.tutorialExperience?.result ?? state.lastResult;
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
  if (route === 'focusResult' && result) {
    if (progress.sessionId && progress.sessionId !== result.id) return 99;
    return step < 19 ? 19 : step;
  }
  if (restoring && route === 'home' && !state.session && step >= 5) return 4;
  if (restoring && route === 'home' && step <= 3) return 0;
  return step;
}
