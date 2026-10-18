import type { ViewStyle } from 'react-native';
import { componentTokens, semanticTokens } from '@/design-system/tokens';

export type FacilityRect = { x: number; y: number; w: number; h: number };
// 기본 마을 원화의 알파 경계. 서버 배치 평행이동은 이 좌표에 별도로 더한다.
export const TILE_FACILITIES: Record<string, FacilityRect> = {
  hall: { x: 949, y: 21, w: 242, h: 244 },
  board: { x: 856, y: 157, w: 80, h: 80 },
  library: { x: 1120, y: 288, w: 239, h: 323 },
  mail: { x: 298, y: 520, w: 46, h: 63 },
  tower: { x: 150, y: 24, w: 112, h: 193 },
  shop: { x: 456, y: 580, w: 262, h: 199 },
  fire: { x: 414, y: 464, w: 115, h: 65 },
  raft: { x: 207, y: 822, w: 169, h: 103 },
};
export const TILE_MAILBOX_Y_OFFSET = -24;
const tokens = componentTokens.tileFacility;

export function facilityTouchBox(rect: FacilityRect, scale: number) {
  const width = Math.max(semanticTokens.size.tapMin, rect.w * scale + tokens.touchPadding * 2);
  const height = Math.max(semanticTokens.size.tapMin, rect.h * scale + tokens.touchPadding * 2);
  return {
    left: (rect.x + rect.w / 2) * scale - width / 2,
    top: (rect.y + rect.h / 2) * scale - height / 2,
    width,
    height,
  };
}

export function facilityPressStyle(
  pressed: boolean,
  reduceMotion: boolean,
  origin?: [number, number, number],
): Pick<ViewStyle, 'opacity' | 'transform' | 'transformOrigin'> {
  if (!pressed) return {};
  if (reduceMotion) return { opacity: tokens.pressedOpacity };
  return {
    transformOrigin: origin ?? ['50%', '100%', 0],
    transform: [{ translateY: tokens.pressOffset }, { scale: tokens.pressScale }],
  };
}

export function facilitySignBox(
  id: string,
  rect: FacilityRect,
  scale: number,
  fontScale = 1,
  label = '',
) {
  // 카메라 배율은 건물에 붙는 위치에만 적용하고, 팻말은 화면 크기를 유지한다.
  // 긴 번역은 글자를 작게 만드는 대신 같은 나무 그림을 가로로 넓힌다.
  const width =
    (label.length > 10
      ? tokens.signLongWidth
      : label.length > 6
        ? tokens.signMediumWidth
        : tokens.signWidth) * fontScale;
  const height = (tokens.signWidth / tokens.signAspectRatio) * fontScale;
  return {
    left:
      id === 'raft'
        ? (rect.x + rect.w) * scale + tokens.raftSignLeftOffset
        : (rect.x + rect.w / 2) * scale - width / 2,
    top:
      id === 'raft'
        ? rect.y * scale - height + tokens.raftSignBottomOffset
        : (rect.y + rect.h) * scale + tokens.signGap,
    width,
    height,
  };
}

/** 전체 섬으로 축소해도 이웃 팻말끼리 겹치지 않게 아래로 나눈다. 뗏목의 확정 위치는 우선한다. */
export function layoutFacilitySigns(
  facilities: { id: string; rect: FacilityRect; label?: string }[],
  scale: number,
  fontScale = 1,
) {
  const out: Record<string, ReturnType<typeof facilitySignBox>> = {};
  const candidates = facilities
    .map(({ id, rect, label }) => ({ id, box: facilitySignBox(id, rect, scale, fontScale, label) }))
    .sort((a, b) => (a.id === 'raft' ? -1 : b.id === 'raft' ? 1 : a.box.top - b.box.top));
  for (const { id, box } of candidates) {
    for (let tries = 0; tries < facilities.length; tries++) {
      const overlap = Object.values(out).find(
        (other) =>
          box.left < other.left + other.width + tokens.signGap &&
          box.left + box.width + tokens.signGap > other.left &&
          box.top < other.top + other.height + tokens.signGap &&
          box.top + box.height + tokens.signGap > other.top,
      );
      if (!overlap) break;
      box.top = overlap.top + overlap.height + tokens.signGap;
    }
    out[id] = box;
  }
  return out;
}

export const TERRAIN_FACILITY_CONTOURS = {
  fire: [
    [2, 31],
    [6, 19],
    [17, 11],
    [30, 5],
    [44, 1],
    [58, 2],
    [70, 0],
    [86, 5],
    [100, 13],
    [109, 24],
    [113, 37],
    [107, 48],
    [96, 55],
    [79, 61],
    [57, 64],
    [35, 61],
    [18, 55],
    [6, 45],
  ],
  raft: [
    [3, 58],
    [13, 48],
    [25, 48],
    [38, 39],
    [53, 31],
    [69, 21],
    [80, 12],
    [90, 6],
    [106, 5],
    [116, 10],
    [133, 12],
    [142, 19],
    [155, 20],
    [165, 28],
    [166, 39],
    [159, 49],
    [142, 55],
    [130, 65],
    [115, 70],
    [97, 80],
    [80, 90],
    [68, 100],
    [54, 101],
    [43, 96],
    [34, 88],
    [20, 88],
    [11, 81],
    [3, 79],
  ],
};
