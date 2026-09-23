/** 고양이 스프라이트의 프레임 순서와 재생 간격을 한곳에서 관리한다. */
export type CatMotion =
  'idle' | 'walk' | 'read' | 'focus' | 'reel' | 'tilt' | 'yawn' | 'stretch' | 'groom';

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
  reel: 100,
  tilt: 260,
  yawn: 320,
  stretch: 360,
  groom: 260,
};

export const IDLE_REST_DELAY_MS = 3_200;

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

export function isFrameAnimated(motion: CatFrameMotion): boolean {
  return CAT_FRAME_SEQUENCES[motion].length > 1;
}
