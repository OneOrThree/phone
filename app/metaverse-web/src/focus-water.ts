import { FOCUS_ISLAND, FOCUS_LANDMARKS, FOCUS_POND } from "./layout.ts";

// 낚시섬 폭포 아래 소·물길·판자 다리의 평면 배치. 렌더(assets3d/pond.ts)와 이동 판정(world.ts)이
// 같은 값을 쓴다. 높이·재질은 렌더 쪽에서 붙이고, 이 파일은 그래픽 의존성 없이 순수 값만 둔다.
const FALL = FOCUS_LANDMARKS.waterfall;
/** 폭포 바로 앞 둥근 소. radius 안이 물이다. */
export const FOCUS_PLUNGE = {
  x: FALL.x,
  z: FALL.z + 1.2,
  radius: 1.02,
} as const;
/** 소에서 연못까지 흐르는 좁은 돌 물길. width는 수면 폭이다. */
export const FOCUS_STREAM = { width: 0.62 } as const;
/** 물길 중심선 x(z): 북쪽 두 의자(x=±1.38) 사이를 살짝 굽이쳐 지난다. */
export const focusStreamX = (z: number) =>
  FALL.x + 0.15 * Math.sin((z + 10.4) * 1.05);
/** 소에서 나오는 곳(-16.04). */
export const FOCUS_STREAM_Z0 = FOCUS_PLUNGE.z + FOCUS_PLUNGE.radius * 0.55;
/** 연못에 들어가는 곳. */
export const FOCUS_STREAM_Z1 = -(FOCUS_POND.radius - 0.25);
/**
 * 물길을 동서로 건너는 판자 다리. 가운데는 (focusStreamX(z), z)이고, length는 x 방향(건너는
 * 방향) 길이, width는 z 방향 폭이다. 윗면은 땅과 거의 같은 높이다.
 */
export type FocusBridge = { z: number; length: number; width: number };
export const FOCUS_BRIDGES: readonly FocusBridge[] = [
  // 물가 길 위
  { z: -(FOCUS_ISLAND.bankRadius + 0.62), length: 1.5, width: 0.95 },
  // 의자 뒤 풀밭
  { z: -14.55, length: 1.4, width: 0.85 },
];
