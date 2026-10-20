/** 고양이 스프라이트의 프레임 순서와 재생 간격을 한곳에서 관리한다. */
export type CatMotion =
  'idle' | 'walk' | 'read' | 'focus' | 'cast' | 'reel' | 'tilt' | 'yawn' | 'stretch' | 'groom';

export type LegacyCatMotion = 'blink' | 'walking' | 'reading' | 'reeling';
export type CatMotionInput = CatMotion | LegacyCatMotion;
export type CatFrameMotion = Exclude<CatMotion, 'idle'> | 'blink';
export type ResolvedCatMotion = CatMotion | 'blink';
export type CatIdleBehavior = Extract<
  CatFrameMotion,
  'blink' | 'tilt' | 'yawn' | 'stretch' | 'groom'
>;

export const CAT_FRAME_SEQUENCES: Record<CatFrameMotion, readonly number[]> = {
  blink: [0, 1, 2, 1, 0],
  walk: [0, 1, 2, 3, 4, 5],
  read: [0, 1, 2, 3, 4, 5],
  focus: [0, 1, 2, 3],
  cast: [0, 1, 2, 3],
  reel: [0, 1, 2, 3],
  tilt: [0, 1, 2, 2, 2, 1],
  yawn: [0, 1, 2, 3],
  stretch: [0, 1, 2, 3],
  groom: [0, 1, 2, 3],
};

export const CAT_FRAME_DELAYS_MS: Record<CatFrameMotion, number> = {
  blink: 90,
  walk: 125,
  read: 220,
  focus: 250,
  cast: 125,
  reel: 100,
  tilt: 260,
  yawn: 320,
  stretch: 360,
  groom: 260,
};

export const IDLE_REST_DELAY_MS = 3_200;

export const INTERACTIVE_MOTION_CYCLES: Record<'tilt' | 'stretch' | 'groom' | 'yawn', number> = {
  tilt: 1, // 6프레임 + 복귀 0번 중립 프레임 = 7프레임 * 260ms = 1,820ms
  stretch: 1, // 4프레임 + 복귀 0번 중립 프레임 = 5프레임 * 360ms = 1,800ms
  groom: 2, // (4프레임 * 2) + 복귀 0번 중립 프레임 = 9프레임 * 260ms = 2,340ms
  yawn: 1, // 4프레임 + 복귀 0번 중립 프레임 = 5프레임 * 320ms = 1,600ms
};

/** 각 상호작용 모션이 모든 프레임 동작을 마치고 중립 프레임(0번)을 표시한 뒤 종료되는 전체 재생 시간(ms) */
export function interactiveMotionDurationMs(motion: 'tilt' | 'stretch' | 'groom' | 'yawn'): number {
  const cycles = INTERACTIVE_MOTION_CYCLES[motion] ?? 1;
  const actionFrames = CAT_FRAME_SEQUENCES[motion].length * cycles;
  return (actionFrames + 1) * CAT_FRAME_DELAYS_MS[motion];
}

/** 기존 화면의 motion 이름을 유지하면서 새 엔진 이름으로 통일한다. */
export function normalizeCatMotion(motion: CatMotionInput | undefined): ResolvedCatMotion {
  switch (motion) {
    case 'walking':
      return 'walk';
    case 'reading':
      return 'read';
    case 'reeling':
      return 'reel';
    case 'blink':
      return 'blink';
    default:
      return motion ?? 'idle';
  }
}

/** 반복 재생에서도 인덱스가 유효한 아틀라스 셀을 벗어나지 않게 한다. */
export function catFrameAt(motion: CatFrameMotion, tick: number): number {
  const frames = CAT_FRAME_SEQUENCES[motion];
  const index = ((Math.floor(tick) % frames.length) + frames.length) % frames.length;
  return frames[index];
}

export function catFrameDelay(motion: CatFrameMotion): number {
  return CAT_FRAME_DELAYS_MS[motion];
}

export function catSequenceLength(motion: CatFrameMotion): number {
  return CAT_FRAME_SEQUENCES[motion].length;
}

/** idle 중 표정/자세를 고르게 섞되, 첫 동작은 항상 눈깜박임으로 시작한다. */
export function nextIdleBehavior(cycle: number, random = Math.random()): CatIdleBehavior {
  if (cycle === 0) return 'blink';
  const behaviors: readonly CatIdleBehavior[] = ['blink', 'tilt', 'yawn', 'stretch', 'groom'];
  return behaviors[Math.min(behaviors.length - 1, Math.floor(random * behaviors.length))];
}

/**
 * 움직임 검토실(doc/animation-lab-2026-10-19/scenes-focus-fishing.js)의 키 포즈 시간표.
 * [셀 번호, 유지 ms]를 차례로 보여 준다. 셀은 기존 4프레임 원본 그대로이고 셀 사이를 섞지 않는다.
 */
export type CatKeyPose = readonly [frame: number, holdMs: number];

// idleFrame(): 12초 중 3.1초·8.8초에만 짧게 1→2→3, 나머지는 중립 0.
export const FOCUS_KEY_POSES: readonly CatKeyPose[] = [
  [0, 3100],
  [1, 160],
  [2, 220],
  [3, 160],
  [0, 5160],
  [1, 160],
  [2, 220],
  [3, 160],
  [0, 2660],
];

/** 낚아올리기 연출 창. FishingActor 상태 타이머(afterForegroundMs 2000)와 같은 값이며 연출이 늘리지 않는다. */
export const REEL_WINDOW_MS = 2000;
/** LAB fishingEnhancedState 의 줄 긴장~안착 구간(초). 이 구간을 2초 창에 비례 압축한다. */
export const REEL_LAB_START_S = 5.5;
export const REEL_LAB_END_S = 8.35;
const REEL_LAB_KEYS = [
  [0, 5.5],
  [1, 6.15],
  [2, 6.72],
  [1, 7.1],
  [3, 7.58],
] as const;
export const REEL_KEY_POSES: readonly CatKeyPose[] = REEL_LAB_KEYS.map(([frame, at], index) => {
  const next = REEL_LAB_KEYS[index + 1]?.[1] ?? REEL_LAB_END_S;
  return [
    frame,
    Math.round(((next - at) / (REEL_LAB_END_S - REEL_LAB_START_S)) * REEL_WINDOW_MS),
  ] as const;
});

/** 키 포즈 시간표가 있는 동작만 돌려준다. focus 는 12초 반복, reel 은 한 번 재생 후 마지막 셀 유지. */
export function catKeyPoses(motion: ResolvedCatMotion): readonly CatKeyPose[] | undefined {
  return motion === 'focus' ? FOCUS_KEY_POSES : motion === 'reel' ? REEL_KEY_POSES : undefined;
}
