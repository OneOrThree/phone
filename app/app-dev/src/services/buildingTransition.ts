import type { Route } from './model';

/** 건물 내부 화면으로 들어가거나 홈 섬으로 돌아올 때 공유하는 전환 계약. */
export type BuildingTransitionTarget = 'hall' | 'board' | 'tower' | 'shop' | 'fire' | 'library';
export type BuildingTransitionDirection = 'enter' | 'return';
export type BuildingTransitionPhase = 'idle' | 'entering' | 'returning';

export const BUILDING_TRANSITION_ROUTE: Record<BuildingTransitionTarget, Route> = {
  hall: 'hall',
  board: 'board',
  tower: 'tower',
  shop: 'shop',
  fire: 'rest',
  library: 'library',
};
export const BUILDING_TRANSITION_RETURN_TARGET: Partial<Record<Route, BuildingTransitionTarget>> = {
  hall: 'hall',
  manage: 'hall',
  board: 'board',
  tower: 'tower',
  shop: 'shop',
  rest: 'fire',
  library: 'library',
};

export const BUILDING_TRANSITION_DURATION_MS = 620;
export const BUILDING_TRANSITION_EASING = 'cubic-in-out' as const;

export type BuildingTransitionState = {
  phase: BuildingTransitionPhase;
  target: BuildingTransitionTarget | null;
  direction: BuildingTransitionDirection | null;
  generation: number;
};

export type BuildingTransitionController = ReturnType<typeof createBuildingTransitionController>;

let cancelActiveTransition: (() => boolean) | null = null;
let routeCoverTimer: ReturnType<typeof setTimeout> | null = null;
let routeCovered = false;

export function isBuildingTransitionRouteCovered() {
  return routeCovered;
}

/** 앱 공통 뒤로가기 처리기가 진행 중인 건물 확대를 우선 취소할 때 사용한다. */
export function cancelBuildingTransition() {
  return cancelActiveTransition?.() ?? false;
}

/**
 * 한 번에 하나의 전환만 실행한다. 전환 중 재탭은 무시하고, 뒤로가기는 진행 중인
 * 진입을 취소해 뒤늦은 navigate가 발생하지 않도록 한다.
 */
export function createBuildingTransitionController() {
  let state: BuildingTransitionState = {
    phase: 'idle',
    target: null,
    direction: null,
    generation: 0,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(next: BuildingTransitionState) => void>();

  const publish = (next: BuildingTransitionState) => {
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  return {
    getState: () => state,
    subscribe(listener: (next: BuildingTransitionState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start(
      target: BuildingTransitionTarget,
      direction: BuildingTransitionDirection,
      reduceMotion: boolean,
      navigate: () => void,
      durationMs = BUILDING_TRANSITION_DURATION_MS,
    ) {
      if (state.phase !== 'idle') return false;
      const generation = state.generation + 1;
      publish({
        phase: direction === 'enter' ? 'entering' : 'returning',
        target,
        direction,
        generation,
      });
      cancelActiveTransition = () => this.cancel();
      const finish = () => {
        if (state.generation !== generation || state.phase === 'idle') return;
        timer = null;
        routeCovered = !reduceMotion;
        if (routeCoverTimer) clearTimeout(routeCoverTimer);
        routeCoverTimer = routeCovered
          ? setTimeout(() => {
              routeCovered = false;
              routeCoverTimer = null;
            }, 900)
          : null;
        navigate();
        publish({ phase: 'idle', target: null, direction: null, generation });
        if (cancelActiveTransition) cancelActiveTransition = null;
      };
      if (reduceMotion) finish();
      else timer = setTimeout(finish, durationMs);
      return true;
    },
    cancel() {
      if (state.phase === 'idle') return false;
      if (timer) clearTimeout(timer);
      timer = null;
      routeCovered = false;
      if (routeCoverTimer) clearTimeout(routeCoverTimer);
      routeCoverTimer = null;
      publish({ phase: 'idle', target: null, direction: null, generation: state.generation + 1 });
      cancelActiveTransition = null;
      return true;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      cancelActiveTransition = null;
      listeners.clear();
    },
  };
}
