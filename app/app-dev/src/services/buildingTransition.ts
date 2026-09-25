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
  stats: 'hall',
  manage: 'hall',
  members: 'hall',
  ledger: 'hall',
  construction: 'hall',
  board: 'board',
  notice: 'board',
  noticeEdit: 'board',
  quest: 'board',
  questEdit: 'board',
  tower: 'tower',
  explore: 'tower',
  visit: 'tower',
  shop: 'shop',
  product: 'shop',
  orders: 'shop',
  rest: 'fire',
  library: 'library',
  diary: 'library',
};

export const BUILDING_TRANSITION_DURATION_MS = 620;
/** 문·망원경 프레임을 먼저 보여 준 뒤 확대 덮개를 시작한다. */
export const BUILDING_SPRITE_LEAD_IN_MS = 660;
export const BUILDING_ENTRY_DURATION_MS =
  BUILDING_SPRITE_LEAD_IN_MS + BUILDING_TRANSITION_DURATION_MS;
export const BUILDING_TRANSITION_EASING = 'cubic-in-out' as const;

export type BuildingTransitionState = {
  phase: BuildingTransitionPhase;
  target: BuildingTransitionTarget | null;
  direction: BuildingTransitionDirection | null;
  generation: number;
};

export type BuildingTransitionController = ReturnType<typeof createBuildingTransitionController>;

type RouteCoverOwner = symbol;
const routeCoverOwners = new Set<RouteCoverOwner>();
const routeCoverTimers = new Map<RouteCoverOwner, ReturnType<typeof setTimeout>>();
const routeCoverListeners = new Set<(covered: boolean) => void>();
let activeTransition: { owner: symbol; cancel: () => boolean } | null = null;

export function isBuildingTransitionRouteCovered() {
  return routeCoverOwners.size > 0;
}

export function subscribeBuildingTransitionRouteCover(listener: (covered: boolean) => void) {
  routeCoverListeners.add(listener);
  return () => {
    routeCoverListeners.delete(listener);
  };
}

function publishRouteCover() {
  const covered = isBuildingTransitionRouteCovered();
  routeCoverListeners.forEach((listener) => listener(covered));
}

function coverRoute(owner: RouteCoverOwner) {
  routeCoverOwners.add(owner);
  publishRouteCover();
  const timer = setTimeout(() => {
    routeCoverTimers.delete(owner);
    routeCoverOwners.delete(owner);
    publishRouteCover();
  }, 900);
  routeCoverTimers.set(owner, timer);
}

function clearRouteCovers() {
  if (!routeCoverOwners.size) return;
  routeCoverTimers.forEach((timer) => clearTimeout(timer));
  routeCoverTimers.clear();
  routeCoverOwners.clear();
  publishRouteCover();
}

/** 인증 초기화처럼 현재 화면을 강제로 교체할 때 남아 있는 로딩 가림을 제거한다. */
export function clearBuildingTransitionRouteCovers() {
  clearRouteCovers();
}

/** 앱 공통 뒤로가기 처리기가 진행 중인 건물 확대를 우선 취소할 때 사용한다. */
export function cancelBuildingTransition() {
  return activeTransition?.cancel() ?? false;
}

/** 시작 거부가 예약 플래그를 영구히 잠그지 않게 호출부의 대기 상태를 정리한다. */
export function beginBuildingEntry(start: () => boolean, clearPending: () => void) {
  const started = start();
  if (!started) clearPending();
  return started;
}

/** 경로가 없어 walk callback이 오지 않는 경우도 포함해 대기 플래그를 항상 정리한다. */
export function runBuildingEntryWalk(
  walk: (onArrival: () => void) => boolean,
  start: () => boolean,
  clearPending: () => void,
) {
  const walking = walk(() => beginBuildingEntry(start, clearPending));
  if (!walking) clearPending();
  return walking;
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
  let cancelActive: (() => void) | null = null;
  const owner = Symbol('building-transition');
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
      onCancel?: () => void,
    ) {
      if (state.phase !== 'idle' || activeTransition) return false;
      if (direction === 'return') clearRouteCovers();
      const generation = state.generation + 1;
      cancelActive = onCancel ?? null;
      activeTransition = { owner, cancel: () => this.cancel() };
      publish({
        phase: direction === 'enter' ? 'entering' : 'returning',
        target,
        direction,
        generation,
      });
      const publishIdle = () => {
        if (activeTransition?.owner === owner) activeTransition = null;
        cancelActive = null;
        publish({ phase: 'idle', target: null, direction: null, generation });
      };
      const finishEnter = () => {
        if (state.generation !== generation || state.phase === 'idle') return;
        timer = null;
        coverRoute(Symbol('building-route-cover'));
        try {
          navigate();
        } finally {
          publishIdle();
        }
      };
      const finishReturn = () => {
        if (state.generation !== generation || state.phase === 'idle') return;
        timer = null;
        publishIdle();
      };

      if (reduceMotion) {
        try {
          navigate();
        } finally {
          publishIdle();
        }
      } else if (direction === 'return') {
        try {
          navigate();
        } catch (error) {
          this.cancel();
          throw error;
        }
        timer = setTimeout(finishReturn, durationMs);
      } else {
        timer = setTimeout(finishEnter, durationMs);
      }
      return true;
    },
    cancel() {
      if (state.phase === 'idle' || activeTransition?.owner !== owner) return false;
      if (timer) clearTimeout(timer);
      timer = null;
      activeTransition = null;
      const notifyCancelled = cancelActive;
      cancelActive = null;
      publish({ phase: 'idle', target: null, direction: null, generation: state.generation + 1 });
      notifyCancelled?.();
      return true;
    },
    dispose() {
      if (activeTransition?.owner === owner) this.cancel();
      listeners.clear();
    },
  };
}
