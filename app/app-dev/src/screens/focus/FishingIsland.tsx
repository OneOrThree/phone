import { FocusEmoteBubble } from './FocusEmoteBubble';
import * as Haptics from 'expo-haptics';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { IslandOcean } from '@/screens/island/IslandOcean';
import { NATIVE, useMapGesture, viewportShift } from '@/screens/island/mapGesture';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
import {
  Animated,
  AccessibilityInfo,
  Easing,
  AppState,
  Image,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ImageStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Ellipse, Path } from 'react-native-svg';
import { Text } from '@/design-system/typography';
import { assets } from '@/constants/assets';
import { art } from '@/constants/art';
import { C, MotionContext } from '@/design-system/primitives';
import { CatSprite, CatMotionInput } from '@/components/CatSprite';
import type { Outfit } from '@/components/CatOutfitLayers';
import { Color, SECONDS_PER_FISH } from '@/services/model';
import { Grid, Point, landPath, nearestLand, waterAt } from '@/utils/world-grid';
import { useAppLayout } from '@/utils/layout';
import { keepLabelInView } from '@/utils/island-camera';
import land from '@/constants/fishing-island.json';
import { catchAssetPath } from '@/screens/focus/catchAssets';
import {
  FishingCatchMotion,
  FishingFloatMotion,
  FishingSceneActive,
  LAB_CAT_PX,
  useFishingPose,
} from '@/screens/focus/FishingSceneMotion';

// v2 시안 낚시섬(focus-island-flow): 좌표는 지도 가로·세로 % (0~100). 지도는 섬 그림(1536×1024) 비율 그대로.
// 땅 격자는 시안 land_mask 에서 온 50×50 칸. 나무·바위 칸('2')은 그림에서 뽑았다(scripts/build-focus-mask.py).
export const fishingGrid: Grid = land;
export const INK = componentTokens.nameplate.ink,
  OUTLINE = componentTokens.nameplate.outline,
  ME = componentTokens.nameplate.me;

const afterForegroundMs = (callback: () => void, durationMs: number) => {
  let remainingMs = durationMs;
  let startedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const isForeground = (state: string | null) => state !== 'background' && state !== 'inactive';
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (startedAt !== null) {
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
      startedAt = null;
    }
  };
  const start = () => {
    if (stopped || timer || startedAt !== null) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = null;
      startedAt = null;
      stopped = true;
      subscription.remove();
      callback();
    }, remainingMs);
  };
  const subscription = AppState.addEventListener('change', (state) => {
    if (isForeground(state)) start();
    else clear();
  });
  if (isForeground(AppState.currentState)) start();
  return () => {
    if (stopped) return;
    stopped = true;
    clear();
    subscription.remove();
  };
};
// 도착 지점 바다 위 뗏목 한 대. 고양이는 뗏목 바로 위쪽의 가장 가까운 땅에 내려 선다.
export const RAFT = { x: 37.8, y: 91.8 };
const FISHING_MAP_ASPECT = 1536 / 1024;
const raftBox = { x: 48, y: 307, w: 928, h: 669 }; // boats/raft/day.png 의 그림 영역
const raftBounds = {
  left: RAFT.x - 6,
  right: RAFT.x + 6,
  top: RAFT.y - ((6 * raftBox.h) / raftBox.w) * FISHING_MAP_ASPECT,
  bottom: RAFT.y + ((6 * raftBox.h) / raftBox.w) * FISHING_MAP_ASPECT,
};
// fishing-rod.png 장축은 오른쪽 위를 향한다. 찌 방향에 맞추려면 이 기준축을 보정한다.
const FISHING_ROD_AXIS_ANGLE = -Math.PI / 4;
// 움직임 검토실 line(): 줄 처짐 52 × (1 - tension .24) LAB px 를 고양이(지도 폭 7.7%) 비율로 옮긴 지도 세로 % 값.
const LINE_SAG = ((52 * (1 - 0.24)) / LAB_CAT_PX) * 7.7 * FISHING_MAP_ASPECT;
export const LANDING = nearestLand(fishingGrid, { x: RAFT.x, y: RAFT.y - 6 });
// 우리 섬에 축음기를 지었으면 낚시섬에도 한 대(지도 폭 6% · 시안 CSS 17:03). 낚시 자리·뗏목·올라오는 길을 피한 남동쪽 풀밭.
export const GRAM = { x: 50, y: 70, w: 6 };
const gramBox = { x: 12, y: 12, w: 608, h: 886 }; // buildings/gramophone/day.png(632×910) 의 그림 영역
// 자리 고르기에서 축음기 그림 위(와 바로 앞, 앉으면 고양이가 그림에 겹치는 곳)는 앉을 수 없다.
// 그림 높이(지도 세로 %) = 폭 6% × 그림 비율 × 지도 비율(1536/1024)
export const nearGram = ({ x, y }: Point) =>
  Math.abs(x - GRAM.x) <= GRAM.w / 2 + 2 &&
  y >= GRAM.y - ((GRAM.w * gramBox.h) / gramBox.w) * (1536 / 1024) &&
  y <= GRAM.y + 4;
export type FishingCatchPlacement = { left: number; top: number };
export type Spot = {
  x: number;
  y: number;
  face: number;
  bx?: number;
  by?: number;
  catchPlacement?: FishingCatchPlacement | null;
};
export const fishingPeerCatchVisible = (actor: {
  visible: boolean;
  seconds: number;
  position: Point;
  spot: Spot;
  phase: string;
}) =>
  actor.visible &&
  Math.floor(actor.seconds / SECONDS_PER_FISH) > 0 &&
  actor.position.x === actor.spot.x &&
  actor.position.y === actor.spot.y &&
  actor.phase !== 'entering' &&
  actor.phase !== 'leaving-pause' &&
  actor.phase !== 'leaving-complete';
export const castAngle = (spot: Spot) =>
  spot.bx == null || spot.by == null
    ? spot.face < 0
      ? Math.PI
      : 0
    : Math.atan2((spot.by - spot.y) / FISHING_MAP_ASPECT, spot.bx - spot.x);
const castReach = (spot: Spot) => {
  if (spot.bx == null || spot.by == null) return 5.6;
  const distance = Math.hypot(spot.bx - spot.x, (spot.by - spot.y) / FISHING_MAP_ASPECT);
  return Math.min(5.6, distance * 0.65);
};
const rodScale = (spot: Spot) => Math.max(0.75, castReach(spot) / 5.6);
// 낚싯대 그림 — 손을 기준으로 물 쪽을 향한다. 낚시 자리와 정보창(GROMO-2474)이 같이 쓴다.
const rodStyle = (spot: Spot, a: number): ImageStyle => {
  const direction = castAngle(spot),
    rodSize = a * 0.6,
    handleX = a * (spot.face < 0 ? 0.29 : 0.71),
    handleY = a * 0.68;
  return {
    position: 'absolute',
    width: rodSize,
    height: rodSize,
    left: handleX - rodSize * 0.06,
    top: handleY - rodSize * 0.94,
    // 물가가 가까워도 손에 든 낚싯대가 고양이 크기에 비해 사라지지 않게 한다.
    transform: [{ scale: rodScale(spot) }, { rotate: `${direction - FISHING_ROD_AXIS_ANGLE}rad` }],
    transformOrigin: [rodSize * 0.06, rodSize * 0.94, 0],
  };
};
// 줄은 낚싯대 끝에서 시작한다. 고양이 손·낚싯대 원화 끝 좌표를 지도 %로 옮긴다.
export const castLineStart = (spot: Spot): Point => {
  const angle = castAngle(spot),
    handleX = spot.x + ((spot.face < 0 ? 0.29 : 0.71) - 0.5) * 7.7,
    handleY = spot.y + (0.68 - 0.90625) * 7.7 * FISHING_MAP_ASPECT,
    reach = 0.6 * 0.9 * Math.SQRT2 * rodScale(spot) * 7.7;
  return {
    x: handleX + Math.cos(angle) * reach,
    y: handleY + Math.sin(angle) * reach * FISHING_MAP_ASPECT,
  };
};
// 누른 곳에 앉히고 12% 안에서 가장 가까운 물 쪽으로 낚싯줄을 던진다. 물이 멀면 줄 없이 앉는다.
// 좌표는 반올림하지 않는다(물가 칸 경계에서 반올림하면 물 칸이 될 수 있음).
export function castSpot({ x, y }: Point): Spot {
  let best: Point | null = null,
    d = 144;
  for (let c = 0; c < fishingGrid.cells.length; c++) {
    // 물 칸으로만 던진다 — 나무·바위('2')는 물이 아니다.
    if (fishingGrid.cells[c] !== '0') continue;
    const wx = (((c % fishingGrid.cols) + 0.5) * fishingGrid.w) / fishingGrid.cols,
      wy = ((Math.floor(c / fishingGrid.cols) + 0.5) * fishingGrid.h) / fishingGrid.rows,
      dd = (wx - x) ** 2 + ((wy - y) / FISHING_MAP_ASPECT) ** 2;
    if (dd < d) {
      d = dd;
      best = { x: wx, y: wy };
    }
  }
  return best ? { x, y, face: best.x < x ? -1 : 1, bx: best.x, by: best.y } : { x, y, face: 1 };
}
// 잡은 물고기 이미지는 고양이 뒤에 놓인다. 배치 단위는 고양이 크기의 배수라
// 화면 크기·방향에 영향받지 않으며, 투명 여백까지 포함한 이미지 프레임이 물에 걸치지 않게 한다(나무·바위 칸은 괜찮다).
const fishingCatchFrame = { width: 1.1, height: 1.1 };
const catchFootprintOnLand = (
  spot: Point,
  left: number,
  top: number,
  width = fishingCatchFrame.width,
  height = fishingCatchFrame.height,
) => {
  const a = 0.077,
    cellWidth = fishingGrid.w / fishingGrid.cols,
    cellHeight = fishingGrid.h / fishingGrid.rows,
    x = spot.x + (left - 0.5) * a * 100,
    y = spot.y + (top - 0.90625) * a * 150,
    right = x + width * a * 100,
    bottom = y + height * a * 150,
    firstCol = Math.floor(x / cellWidth),
    lastCol = Math.ceil((right - 1e-9) / cellWidth) - 1,
    firstRow = Math.floor(y / cellHeight),
    lastRow = Math.ceil((bottom - 1e-9) / cellHeight) - 1;
  for (let row = firstRow; row <= lastRow; row++)
    for (let col = firstCol; col <= lastCol; col++)
      if (waterAt(fishingGrid, col, row)) return false;
  return true;
};
const catchBounds = (spot: Point, placement: FishingCatchPlacement) => {
  const left = spot.x + (placement.left - 0.5) * 0.077 * 100,
    top = spot.y + (placement.top - 0.90625) * 0.077 * 150;
  return {
    left,
    top,
    right: left + fishingCatchFrame.width * 0.077 * 100,
    bottom: top + fishingCatchFrame.height * 0.077 * 150,
  };
};
const catBounds = (spot: Point) => ({
  left: spot.x - (0.077 * 100) / 2,
  right: spot.x + (0.077 * 100) / 2,
  top: spot.y - 0.90625 * 0.077 * 150,
  bottom: spot.y + 0.09375 * 0.077 * 150,
});
const boundsOverlap = (a: ReturnType<typeof catBounds>, b: ReturnType<typeof catBounds>) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
/** 보상 프레임을 고양이 옆 인접 위치에서만 찾고, 가까운 육지 후보가 없으면 숨긴다. */
export function fishingCatchPlacement(
  spot: Spot,
  others: Spot[] = [],
  visibleRewardSpots?: Spot[],
  gramVisible = true,
  futurePeerSpots?: Spot[],
): FishingCatchPlacement | null {
  if (Object.prototype.hasOwnProperty.call(spot, 'catchPlacement'))
    return spot.catchPlacement ?? null;
  const preferredLeft = spot.face < 0 ? 0.9 : -1,
    alternateLeft = preferredLeft < 0 ? 0.9 : -1,
    ownCat = catBounds(spot),
    gramBounds = {
      left: GRAM.x - GRAM.w / 2,
      right: GRAM.x + GRAM.w / 2,
      top: GRAM.y - ((GRAM.w * gramBox.h) / gramBox.w) * FISHING_MAP_ASPECT,
      bottom: GRAM.y,
    };
  // Resident의 저장된 보상은 아직 숨겨져 있어도 나중에 표시될 수 있으므로 mine 고양이와는 항상 충돌 검사한다.
  const peerObstacles = [...others, ...(futurePeerSpots ?? [])],
    reservedRewardBounds = peerObstacles
      .filter(
        (other) => !(other.x === spot.x && other.y === spot.y) && other.catchPlacement != null,
      )
      .map((other) => catchBounds(other, other.catchPlacement!));
  if (reservedRewardBounds.some((reward) => boundsOverlap(reward, ownCat))) return null;
  let best: (FishingCatchPlacement & { score: number }) | null = null;
  for (let left = -3; left <= 2.001; left += 0.25)
    for (let top = -3; top <= 2.001; top += 0.25) {
      const preferredScore = Math.hypot(left - preferredLeft, top - 0.06),
        alternateScore = Math.hypot(left - alternateLeft, top - 0.06),
        score = preferredScore <= 0.75 ? preferredScore : alternateScore + 1;
      if (preferredScore > 0.75 && alternateScore > 0.75) continue;
      if (!catchFootprintOnLand(spot, left, top)) continue;
      const reward = catchBounds(spot, { left, top });
      if (gramVisible && boundsOverlap(reward, gramBounds)) continue;
      if (boundsOverlap(reward, raftBounds)) continue;
      if (
        peerObstacles.some((other) => {
          if (other.x === spot.x && other.y === spot.y) return false;
          const otherCat = catBounds(other),
            rewardVisible =
              visibleRewardSpots == null ||
              visibleRewardSpots.some((visible) => visible.x === other.x && visible.y === other.y),
            otherReward =
              rewardVisible && other.catchPlacement
                ? catchBounds(other, other.catchPlacement)
                : null;
          return (
            boundsOverlap(reward, otherCat) ||
            (otherReward != null && boundsOverlap(reward, otherReward))
          );
        })
      )
        continue;
      if (best && score >= best.score) continue;
      best = { left, top, score };
    }
  return best ? { left: best.left, top: best.top } : null;
}
export function fishingCatchFootprintOnLand(
  spot: Point,
  placement: FishingCatchPlacement,
  width = fishingCatchFrame.width,
  height = fishingCatchFrame.height,
) {
  return catchFootprintOnLand(spot, placement.left, placement.top, width, height);
}
// 지도 % 좌표 사이 거리(세로 %는 지도 비율 1024/1536으로 맞춰 지도 폭 % 단위로 잰다)
const apart = (p: Point, q: Point) => Math.hypot(q.x - p.x, (q.y - p.y) / FISHING_MAP_ASPECT);
// 스크린리더로 자리를 고를 때 앉는 기본 빈 자리. 시안 예시 내 자리(34.1, 55.9)는 연못 물 칸이라 한 칸 아래.
export const DEFAULT_SPOT = { x: 34.1, y: 57 };
const defaultCatchSpot = castSpot(DEFAULT_SPOT);
export const DEFAULT_CATCH_PLACEMENT = fishingCatchPlacement(defaultCatchSpot);
const DEFAULT_CATCH_RESERVATION: Spot = {
  ...defaultCatchSpot,
  catchPlacement: DEFAULT_CATCH_PLACEMENT,
};
// spot 고양이의 물고기 더미(placement)가 other 에 앉은 고양이를 덮는지
export const catchOverlapsCat = (spot: Point, placement: FishingCatchPlacement, other: Point) =>
  boundsOverlap(catchBounds(spot, placement), catBounds(other));
// 내가 DEFAULT_SPOT 에 앉으면 물고기 더미는 주민을 피하지 않는 고정 자리다 — 그 더미가 p 에 앉은 고양이를 덮는지
export const underDefaultCatch = (p: Point) =>
  DEFAULT_CATCH_PLACEMENT != null &&
  boundsOverlap(catBounds(p), catchBounds(defaultCatchSpot, DEFAULT_CATCH_PLACEMENT));
// 낚시 중인 주민 자리. 내 세션에서는 나를 뺀 14명, 방문 화면에서는 정원 15명 모두를 담는다.
// resident 자리/보상은 섬 건물 상태와 무관하게 같은 좌표를 쓰도록 축음기 설치 상태 기준으로 미리 배치한다.
// 나머지는 섬 가운데에 가까운 땅 칸부터 훑어, 이미 정한 자리·축음기·뗏목 내리는 곳·기본 내 자리와 지도 폭 10.5% 넘게
// 떨어지고 12% 안에 물이 있는(낚싯줄을 던질 수 있는) 곳을 차례로 더한다. 모두 땅 위이고 서로 겹치지 않는다.
export const PEER_SPOTS: Spot[] = (() => {
  const initial: Spot[] = [
      // 시안 좌표(18.5, 39.5)·(60.2, 44.1)은 물·바위 칸이라 가까운 걸을 수 있는 칸으로 옮겼다.
      { x: 17.5, y: 39.5 },
      { x: 62.5, y: 43 },
      { x: 45, y: 25 },
      { x: 70, y: 30 },
      { x: 80, y: 62 },
      { x: 75, y: 45 },
      { x: 40, y: 70 },
    ].map(castSpot),
    spots: Spot[] = [],
    avoid = [GRAM, LANDING, DEFAULT_SPOT],
    { cols, cells } = fishingGrid,
    dry = (c: number) => cells[c] !== '0',
    candidates: Point[] = [];
  for (let c = 0; c < cells.length; c++) {
    const col = c % cols,
      row = Math.floor(c / cols);
    // 걸을 수 있는 칸 가운데 네 이웃이 물이 아닌 칸(물가 끝에 걸치지 않게, 나무·바위 옆은 괜찮다)
    if (
      col &&
      row &&
      col < cols - 1 &&
      row < cols - 1 &&
      cells[c] === '1' &&
      [c - 1, c + 1, c - cols, c + cols].every(dry)
    )
      candidates.push({ x: (col + 0.5) * 2, y: (row + 0.5) * 2 });
  }
  for (const spot of initial) {
    const placement = fishingCatchPlacement(spot, [
      ...initial,
      ...spots,
      DEFAULT_CATCH_RESERVATION,
    ]);
    if (placement) spots.push({ ...spot, catchPlacement: placement });
  }
  candidates.sort((a, b) => apart(a, { x: 50, y: 50 }) - apart(b, { x: 50, y: 50 }));
  for (const p of candidates) {
    if (spots.length >= 15) break;
    const spot = castSpot(p);
    const placement = fishingCatchPlacement(spot, [...spots, DEFAULT_CATCH_RESERVATION]);
    if (
      !nearGram(p) &&
      // 나무·바위 칸(티켓 2516)이 빠진 뒤 11% 로는 14자리뿐이라 10.5%. 고양이 겹침 기준(SEAT_GAP 8.5%)보다는 넓다.
      [...spots, ...avoid].every((q) => apart(p, q) >= 10.5) &&
      spot.bx != null &&
      placement
    )
      spots.push({ ...spot, catchPlacement: placement });
  }
  // 시안 예시 두 자리는 낚싯줄 끝도 시안 좌표 그대로. 여섯째 자리(축음기 앞)는 새로 뽑은 첫 자리로 채운다
  const cast = spots;
  // 여섯째 자리(축음기 앞)는 새로 뽑은 첫 자리로 채운다. 모든 찌는 같은 물 mask 계산을 쓴다.
  return [...cast.slice(0, 5), cast[7], ...cast.slice(5, 7), ...cast.slice(8)];
})();
// 다른 주민과 고양이가 겹치는 자리인지. 고양이 폭이 지도 폭 7.7%라 여유를 더해 8.5% 안이면 앉을 수 없다.
export const SEAT_GAP = 8.5;
export const occupied = (p: Point, spots: Point[]) => spots.some((q) => apart(p, q) < SEAT_GAP);
/** 실시간 주민도 내 고양이와 같은 땅 격자 경로를 따라 이동한다. */
export const peerLandRoute = (from: Point, to: Point) => {
  const cells = landPath(fishingGrid, from, to);
  return cells.length ? [...cells.slice(1, -1), to] : [];
};
export const peerPointFromPixels = (left: number, top: number, size: number, sizeY: number) => ({
  x: ((left + (size * 0.077) / 2) * 100) / size,
  y: ((top + size * 0.077 * 0.90625) * 100) / sizeY,
});
export const peerPixelsAtSize = (
  left: number,
  top: number,
  fromSize: number,
  fromSizeY: number,
  size: number,
  sizeY: number,
) => {
  const point = peerPointFromPixels(left, top, fromSize, fromSizeY);
  return {
    left: (size * point.x) / 100 - (size * 0.077) / 2,
    top: (sizeY * point.y) / 100 - size * 0.077 * 0.90625,
  };
};
export const peerWalkFace = (from: Point, to: Point, fallback: number) =>
  Math.abs(to.x - from.x) > 0.15 ? (to.x < from.x ? -1 : 1) : fallback;
// 뗏목(지도 폭 12%)과 내리는 자리 위에는 앉을 수 없다. 앉은 고양이(폭 7.7%·발 기준) 상자가 겹치는지로 본다.
// 세로 %는 지도 비율(1024/1536)로 맞춰 가로 % 단위로 잰다.
const toW = (y: number) => (y * 1024) / 1536;
const catRect = (p: Point) => ({
  l: p.x - 3.85,
  r: p.x + 3.85,
  t: toW(p.y) - 7.7,
  b: toW(p.y),
});
const raftRect = {
  l: RAFT.x - 6,
  r: RAFT.x + 6,
  t: toW(RAFT.y) - (6 * 669) / 928,
  b: toW(RAFT.y) + (6 * 669) / 928,
};
const hit = (a: { l: number; t: number; r: number; b: number }, b: typeof raftRect) =>
  a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
export const nearRaft = (p: Point) =>
  hit(catRect(p), raftRect) || hit(catRect(p), catRect(LANDING));
// 서 있는 자리에서 집중을 시작할 수 있는지 — 뗏목 · 축음기 · 앉은 주민만 본다. 고양이는 걸을 수 있는 칸('1')으로만
// 걸어가므로 물·나무·바위는 볼 필요가 없다. 물고기 더미는 놓을 땅이 없으면 숨기므로 자리 조건이 아니다.
export type SeatProblem = 'occupied' | 'nearGram' | 'nearRaft';
export const seatProblem = (
  p: Point,
  peerSpots: Point[],
  gramBuilt: boolean,
): SeatProblem | null =>
  occupied(p, peerSpots)
    ? 'occupied'
    : gramBuilt && nearGram(p)
      ? 'nearGram'
      : nearRaft(p)
        ? 'nearRaft'
        : null;
// 뒤 화면을 스크린리더에서 숨긴다(모달·준비 카드가 떠 있을 때)
export const a11yHidden = (hidden: boolean) =>
  hidden
    ? {
        importantForAccessibility: 'no-hide-descendants' as const,
        accessibilityElementsHidden: true,
        'aria-hidden': true,
      }
    : {};
export const hms = (n: number) =>
  [n / 3600, (n / 60) % 60, n % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
// 지도 창: 지도 폭은 세로 640px × 배율, 폭 600 이상(가로)은 화면 폭 × 배율. 보는 곳(focus)을 가로 가운데·세로 ratio 높이에 둔다.
export function fishingCamera(
  w: number,
  h: number,
  zoom: number,
  focus: Point & { upperOcean?: boolean },
  ratio = 0.5,
) {
  const size = (w >= 600 ? w : 640) * zoom,
    sizeY = (size * 1024) / 1536,
    offTop = Math.max(0, (h - sizeY) / 2),
    minSy = -h * componentTokens.fishingViewport.upperOceanPanRatio,
    maxSy = Math.max(0, sizeY - h),
    // 스크롤 위치는 브라우저처럼 정수 픽셀(지도 크기·위치도 정수로 반올림해 계산)
    // 0.8배로 줄여 지도가 화면보다 좁으면(가로·태블릿) 가로 가운데에 둔다
    sx =
      size < w
        ? Math.round((size - w) / 2)
        : Math.round(Math.max(0, Math.min(size - w, (Math.round(size) * focus.x) / 100 - w / 2))),
    sy = Math.round(
      Math.max(
        focus.upperOcean ? minSy : 0,
        Math.min(maxSy, Math.round(offTop) + (Math.round(sizeY) * focus.y) / 100 - h * ratio),
      ),
    );
  return { size, sizeY, offTop, sx, sy, minSy, maxSy, left: -sx, top: offTop - sy };
}
// 집중 준비 카드 위치: 내 고양이(x, y 발 기준, 고양이 크기 a) 위 → 아래 → 오른쪽 → 왼쪽 중 화면(W×H) 안에 들어가는 첫 자리.
// 좌우·위아래 여백은 안전 영역(노치·홈 인디케이터)을 지킨다. 어디에도 안 들어가면(가로 화면에 키보드가 떠 H가 작을 때)
// 버튼이 보이게 카드 아래를 화면 안에 맞추고 위로 올린다.
export function anchorCard(
  x: number,
  y: number,
  a: number,
  dw: number,
  dh: number,
  W: number,
  H: number,
  safe = { top: 0, bottom: 0, left: 0, right: 0 },
) {
  const T = Math.max(W > H ? 12 : 60, safe.top + 4),
    L = safe.left + 8,
    R = W - safe.right - 8,
    B = H - safe.bottom - 8,
    hx = Math.max(L, Math.min(R - dw, x - dw / 2)),
    vy = Math.min(B - dh, Math.max(T, y - a / 2 - dh / 2));
  const [top, left] = [
    [y - a - 10 - dh, hx],
    [y + 26, hx],
    [vy, x + a / 2 + 12],
    [vy, x - a / 2 - 12 - dw],
  ].find(([t, l]) => t >= T && t + dh <= B && l >= L && l + dw <= R) ?? [vy, hx];
  return { top, left };
}
// 화면보다 큰 지도·배경을 자르는 컨테이너. 웹의 hidden 은 포커스·scrollIntoView 로 속이 밀릴 수 있어 clip 을 쓴다.
export const clip = (Platform.OS === 'web' ? 'clip' : 'hidden') as 'hidden';
export function FishingIsland({
  focus,
  ratio = 0.5,
  spots,
  onTap,
  onSitAccessible,
  onRaft,
  raftLabel = t('focusFlow.common.raftLabel'),
  gram = false,
  onGram,
  seated = false,
  inert = false,
  children,
  overlay,
  overlayBlocksMap = true,
  goldenFish = false,
}: {
  focus: Point;
  ratio?: number;
  spots: Spot[];
  onTap?: (p: Point) => void;
  /** 스크린리더 「빈 자리에 앉기」 동작. 없으면 onTap(DEFAULT_SPOT). */
  onSitAccessible?: () => void;
  onRaft: () => void;
  raftLabel?: string;
  // 축음기(우리 섬에 지었을 때만 보임). onGram 이 없으면 그림만(누를 수 없음), 누르면 음악 고르기만 열리고 고양이는 걷지 않는다
  gram?: boolean;
  onGram?: () => void;
  // 모달이 떠 있으면 지도를 스크린리더에서 숨긴다
  inert?: boolean;
  // 내 자리가 있으면 1.4배 이상 확대할 때 내 자리를 가운데로
  seated?: boolean;
  children: (size: number, sizeY: number, zoom: number) => React.ReactNode;
  overlay?: (toScreen: (p: Point) => Point, size: number) => React.ReactNode;
  /** 단순 안내 오버레이는 지도 이동과 접근성을 막지 않는다. */
  overlayBlocksMap?: boolean;
  /** 황금 물고기 컷신 재생이 끝난 뒤 섬에 남는 에셋. */
  goldenFish?: boolean;
}) {
  const L = useAppLayout();
  const reduceMotion = useContext(MotionContext);
  const [cam, setCam] = useState({ zoom: 1, x: focus.x, y: focus.y, upperOcean: false });
  // 상태가 바뀌면(도착·준비·집중·결과) 다시 내 자리를 보여 준다. 확대 배율은 유지.
  useEffect(
    () => setCam((c) => ({ ...c, x: focus.x, y: focus.y, upperOcean: false })),
    [focus.x, focus.y, ratio],
  );
  const view = fishingCamera(L.width, L.height, cam.zoom, cam, ratio);
  const live = useRef({ cam, L, ratio, focus, seated, overlay, overlayBlocksMap });
  live.current = { cam, L, ratio, focus, seated, overlay, overlayBlocksMap };
  const gesture = useMapGesture(cam);
  const hudTransform = useMemo(
    () => ({ inverseScale: gesture.inverseScale, zoom: cam.zoom }),
    [gesture, cam.zoom],
  );
  // 끌기 기준점. 손가락 수가 바뀌면(핀치 → 한 손가락) 지금 위치에서 다시 잡아 지도가 튀지 않게 한다
  const start = useRef({ zoom: 1, x: 0, y: 0, dist: 0, n: 0, dx: 0, dy: 0 }),
    dragged = useRef(false),
    node = useRef<View>(null);
  // 확대·축소 0.8~1.8배: 보던 곳을 유지하고, 1.4배부터는 내 자리를 가운데로
  const zoomed = (c: typeof cam, z: number) => {
    const zoom = Math.max(0.8, Math.min(1.8, z)),
      { focus: f, seated: me } = live.current;
    return zoom >= 1.4 && me ? { zoom, x: f.x, y: f.y, upperOcean: false } : { ...c, zoom };
  };
  // 끄는 동안(GROMO-2373): state 는 그대로 두고 커밋된 지도를 c 카메라 자리로 옮겨 보이기만 한다.
  const show = (c: typeof cam) => {
    const { cam: committed, L: l, ratio: r } = live.current,
      from = fishingCamera(l.width, l.height, committed.zoom, committed, r),
      to = fishingCamera(l.width, l.height, c.zoom, c, r);
    gesture.show(
      c,
      viewportShift(
        { left: from.left, top: from.top, scale: from.size },
        { left: to.left, top: to.top, scale: to.size },
        l.width,
        l.height,
      ),
    );
  };
  // 손을 떼면 보이는 카메라로 한 번만 다시 배치한다. transform 은 커밋 직후 useMapGesture 가 항등으로 되돌린다.
  const settle = () => {
    const c = gesture.release();
    if (c) setCam(c);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // 집중 준비 카드가 떠 있으면 지도를 끌지 않는다
      onMoveShouldSetPanResponder: (e, g) =>
        !(live.current.overlay && live.current.overlayBlocksMap) &&
        ((e.nativeEvent.touches?.length ?? 0) > 1 || Math.abs(g.dx) + Math.abs(g.dy) > 6),
      onPanResponderGrant: () => {
        start.current.n = 0;
        dragged.current = true;
      },
      onPanResponderMove: (e, g) => {
        const n = Math.max(1, e.nativeEvent.touches?.length ?? 1),
          t = e.nativeEvent.touches ?? [],
          s = start.current,
          c = gesture.visible(),
          { L: l, ratio: r } = live.current,
          v = fishingCamera(l.width, l.height, c.zoom, c, r);
        if (n !== s.n) {
          start.current = { zoom: c.zoom, x: v.sx, y: v.sy, dist: 0, n, dx: g.dx, dy: g.dy };
          return;
        }
        if (n > 1) {
          const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
          if (!s.dist) s.dist = d;
          else show(zoomed(c, (s.zoom * d) / s.dist));
          return;
        }
        // 끌어서 둘러보기: 스크롤 위치를 제한한 뒤 보는 곳으로 되돌려 저장한다(끝에 걸린 채 더 끌어도 밀리지 않게).
        // 가로는 지도 폭으로 제한하고, 세로는 지도 위 바다까지 화면 반 높이만큼 더 이동한다.
        const sx = Math.max(0, Math.min(v.size - l.width, s.x - (g.dx - s.dx))),
          sy = Math.max(v.minSy, Math.min(v.maxSy, s.y - (g.dy - s.dy)));
        show({
          zoom: c.zoom,
          upperOcean: true,
          x: v.size > l.width ? ((sx + l.width / 2) / v.size) * 100 : c.x,
          y: ((sy - v.offTop + l.height * r) / v.sizeY) * 100,
        });
      },
      onPanResponderRelease: () => {
        settle();
        setTimeout(() => (dragged.current = false), 80);
      },
      onPanResponderTerminate: () => {
        settle();
        dragged.current = false;
      },
    }),
  ).current;
  // 트랙패드 핀치(ctrl+휠)로 확대·축소
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = node.current as any;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setCam((c) => zoomed(c, c.zoom * Math.exp(-e.deltaY / 200)));
    };
    el?.addEventListener?.('wheel', wheel, { passive: false });
    return () => el?.removeEventListener?.('wheel', wheel);
  }, []);
  // 상단 바다로 더 이동하는 거리까지 미리 깐다. 끄는 동안 바깥 변환만 움직여도 빈 영역이 생기지 않는다.
  const minView = fishingCamera(L.width, L.height, 0.8, cam, ratio),
    minScale = minView.size / 1536,
    reachX = L.width / 2 / minScale,
    reachY = L.height / 2 / minScale,
    oceanCover = {
      left: -reachX,
      top: -reachY + minView.minSy / minScale,
      right: 1536 + reachX,
      bottom: 1024 + reachY,
    };
  const { size, sizeY, left, top } = view,
    raftW = size * 0.12,
    gramW = (size * GRAM.w) / 100,
    raftK = raftW / raftBox.w;
  const visibleX = useMemo(
    () => ({
      lo: L.insets.left - left,
      hi: L.width - L.insets.right - left,
      fontScale: L.fontScale ?? 1,
    }),
    [left, L.width, L.insets.left, L.insets.right, L.fontScale],
  );
  return (
    <View
      ref={node}
      testID="fishing-world"
      {...pan.panHandlers}
      style={{ flex: 1, backgroundColor: '#74B9B9', overflow: clip }}
    >
      {/* 지도 손가락 변환(GROMO-2373): 끄는 동안 이 컨테이너 하나만 움직이고 쉬는 동안은 항등이다. */}
      <Animated.View
        testID="fishing-map-transform"
        pointerEvents="box-none"
        collapsable={false}
        style={[
          StyleSheet.absoluteFill,
          { width: L.width, height: L.height, transform: gesture.transform },
        ]}
      >
        <IslandOcean left={left} top={top} scale={size / 1536} cover={oceanCover} />
        <View
          testID="fishing-map"
          style={{ position: 'absolute', left, top, width: size, height: sizeY }}
          {...a11yHidden(inert || (!!overlay && overlayBlocksMap))}
        >
          <Pressable
            // 스크린리더 사용자는 좌표를 누를 수 없으니 "빈 자리에 앉기" 동작으로 기본 빈 자리를 고른다
            accessible={!!onTap}
            accessibilityRole={onTap ? 'button' : undefined}
            accessibilityLabel={onTap ? t('focusFlow.spot.groundA11y') : undefined}
            accessibilityActions={
              onTap ? [{ name: 'activate', label: t('focusFlow.spot.sitEmptyA11y') }] : undefined
            }
            onAccessibilityAction={() =>
              onSitAccessible ? onSitAccessible() : onTap?.(DEFAULT_SPOT)
            }
            style={StyleSheet.absoluteFill}
            onPress={(e) => {
              if (dragged.current || !onTap) return;
              const ev = e.nativeEvent as any,
                rect =
                  Platform.OS === 'web' ? (e.currentTarget as any).getBoundingClientRect() : null;
              onTap({
                x: ((rect ? ev.clientX - rect.left : ev.locationX) / size) * 100,
                y: ((rect ? ev.clientY - rect.top : ev.locationY) / sizeY) * 100,
              });
            }}
          >
            <Image
              source={require('@/assets/backgrounds/island/ocean/focus-day.png')}
              style={{ width: '100%', height: '100%' }}
              resizeMode="stretch"
            />
          </Pressable>
          {spots
            .filter((s) => s.bx != null)
            .map((s, n) => {
              const start = castLineStart(s),
                sag = (start.y + s.by!) / 2 + LINE_SAG,
                // 줄 하나를 감싸는 상자(지도 %, 선 굵기 여유 0.1)만 그린다 — 지도 크기 SVG 는 확대할수록 비트맵이 커진다(GROMO-2373).
                x0 = Math.min(start.x, s.bx! - 0.35) - 0.1,
                x1 = Math.max(start.x, s.bx! + 0.35) + 0.1,
                y0 = Math.min(start.y, s.by! - 0.2, sag) - 0.1,
                y1 = Math.max(start.y, s.by! + 0.2, sag) + 0.1;
              return (
                <Svg
                  key={n}
                  pointerEvents="none"
                  width={((x1 - x0) * size) / 100}
                  height={((y1 - y0) * sizeY) / 100}
                  viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`}
                  preserveAspectRatio="none"
                  style={{
                    position: 'absolute',
                    zIndex: 3,
                    left: (x0 * size) / 100,
                    top: (y0 * sizeY) / 100,
                  }}
                >
                  <Path
                    d={`M ${start.x} ${start.y} Q ${(start.x + s.bx!) / 2} ${sag} ${s.bx} ${s.by}`}
                    fill="none"
                    stroke="#fff5db"
                    strokeWidth={0.14}
                  />
                  <Ellipse
                    cx={s.bx}
                    cy={s.by}
                    rx={0.35}
                    ry={0.2}
                    fill="#f28c77"
                    stroke="#946752"
                    strokeWidth={0.06}
                  />
                </Svg>
              );
            })}
          <FishingFloatMotion
            active={!inert && !reduceMotion}
            spots={spots
              .filter((s) => s.bx != null)
              .map((s, n) => ({
                key: String(n),
                x: (size * s.bx!) / 100,
                y: (sizeY * s.by!) / 100,
                face: s.face < 0 ? -1 : 1,
                k: (size * 0.077) / LAB_CAT_PX,
              }))}
          />
          {goldenFish && (
            <Image
              source={art['fish/gold']}
              accessibilityLabel={t('focusFlow.fish.goldenCaughtImageA11y')}
              testID="fishing-island-golden-fish"
              resizeMode="contain"
              style={{
                position: 'absolute',
                zIndex: 14,
                left: size * 0.5 - size * 0.045,
                top: sizeY * 0.54 - size * 0.045,
                width: size * 0.09,
                height: size * 0.09,
              }}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={raftLabel}
            testID="fishing-raft"
            // 지도를 끌다 뗏목 위에서 손을 떼면 누르기로 치지 않는다
            onPress={() => !dragged.current && onRaft()}
            style={{
              position: 'absolute',
              zIndex: 15,
              left: (size * RAFT.x) / 100 - raftW / 2,
              top: (sizeY * RAFT.y) / 100 - (raftBox.h * raftK) / 2,
              width: raftW,
              height: raftBox.h * raftK,
              overflow: 'hidden',
            }}
          >
            <Image
              source={assets['boats/raft/day.png']}
              style={{
                position: 'absolute',
                left: -raftBox.x * raftK,
                top: -raftBox.y * raftK,
                width: 1024 * raftK,
                height: 1024 * raftK,
              }}
            />
          </Pressable>
          {gram && (
            <Pressable
              accessible={!!onGram}
              accessibilityRole={onGram ? 'button' : undefined}
              accessibilityLabel={onGram ? t('focusFlow.music.gramA11y') : undefined}
              testID="fishing-gram"
              onPress={() => !dragged.current && onGram?.()}
              // 그림이 작아(세로 폭 약 38px) 누르는 영역을 사방 8px 넓힌다
              hitSlop={8}
              style={{
                position: 'absolute',
                // 자리 고르기 등 누를 수 없는 단계에서는 그림만(누르면 땅 누르기로 내려감)
                pointerEvents: onGram ? 'auto' : 'none',
                zIndex: 20 + Math.round(GRAM.y),
                left: (size * GRAM.x) / 100 - gramW / 2,
                top: (sizeY * GRAM.y) / 100 - (gramW * gramBox.h) / gramBox.w,
                width: gramW,
                height: (gramW * gramBox.h) / gramBox.w,
                overflow: 'hidden',
              }}
            >
              <Image
                source={assets['buildings/gramophone/day.png']}
                style={{
                  position: 'absolute',
                  left: (-gramBox.x * gramW) / gramBox.w,
                  top: (-gramBox.y * gramW) / gramBox.w,
                  width: (632 * gramW) / gramBox.w,
                  height: (910 * gramW) / gramBox.w,
                }}
              />
            </Pressable>
          )}
          <FishingSceneActive.Provider value={!inert}>
            <FishingVisibleX.Provider value={visibleX}>
              <FishingHudTransform.Provider value={hudTransform}>
                {children(size, sizeY, cam.zoom)}
              </FishingHudTransform.Provider>
            </FishingVisibleX.Provider>
          </FishingSceneActive.Provider>
        </View>
      </Animated.View>
      {overlay?.((p) => ({ x: left + (size * p.x) / 100, y: top + (sizeY * p.y) / 100 }), size)}
    </View>
  );
}
/** HUD 위치는 지도 좌표를 따르고, 글자에는 손가락 확대 배율의 역변환만 적용한다. */
export const FishingHudTransform = React.createContext<{
  inverseScale: Animated.AnimatedDivision<number>;
  zoom: number;
} | null>(null);

// 지금 화면에 보이는 가로 범위(지도 px, 안전 영역 제외). 지도가 화면보다 넓어 가장자리 자리의 머리 위 말풍선·이름이
// 잘리므로 FishingActor 가 이 범위 기준으로 민다(keepLabelInView). 제공자 밖(단독 렌더)에서는 밀지 않는다.
// fontScale 은 글자 폭 추정용 OS 접근성 글자 배율이다.
const FishingVisibleX = React.createContext<{ lo: number; hi: number; fontScale: number } | null>(
  null,
);
// 머리 위 과목·시간표 상자 폭(지도 px). 글자 폭은 대략값: 10px 한글 한 자 ≈ 10px, 시간 8자 ≈ 50px, 최대 120px
const labelWidth = (subject: string) => Math.min(120, 16 + Math.max(50, [...subject].length * 10));
// 머리 위 과목·시간표 상자(지도 px)
export function labelBox(spot: Spot, subject: string, size: number, sizeY: number) {
  const a = size * 0.077,
    w = labelWidth(subject),
    x = (size * spot.x) / 100,
    bottom = (sizeY * spot.y) / 100 - a * 0.95625;
  return { left: x - w / 2, right: x + w / 2, top: bottom - 40, bottom };
}
const label = {
  fontSize: 10,
  lineHeight: 16,
  fontWeight: '800' as const,
  color: INK,
  textAlign: 'center' as const,
};
export const nameText = (me: boolean) => ({
  fontSize: 11,
  lineHeight: 17.6,
  fontWeight: '900' as const,
  color: me ? ME : INK,
  textShadowColor: componentTokens.nameplate.shadow,
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 5,
});
// 낚시하는 고양이(fi-actor): 지도 폭 7.7% · 발 기준점(256,464)/512 · 머리 위 과목·시간표(이모티콘이 오면 그 자리에 3초) · 아래 이름.
// 집중 화면에는 잡은 수를 숫자로 보이지 않는다(1마리, 3마리 작은 더미, 6마리 중간 더미, 10마리 큰 더미).
export function FishingActor({
  spot,
  size,
  sizeY,
  color,
  name,
  me = false,
  subject,
  seconds,
  emote,
  reduce,
  goldenFishCount = 0,
  tutorialFish = false,
  caughtFish,
  goldenCatchToken,
  motion,
  catchVisible = true,
  catchVisibleSpots,
  catchGramVisible = true,
  catchFuturePeerSpots,
  onMotionFinish,
  generation,
  animatedPosition,
  catchAvoidSpots = [],
  outfit,
}: {
  spot: Spot;
  size: number;
  sizeY: number;
  color: Color;
  name: string;
  me?: boolean;
  subject?: string | null;
  seconds: number;
  emote?: string | null;
  reduce: boolean;
  /** 황금 물고기 사건에 참여한 고양이의 더미에 남긴다. */
  goldenFishCount?: number;
  /** 서버 지급이 확인된 첫 낚시 보상. 경과 시간을 가짜로 늘리지 않고 더미에만 더한다. */
  tutorialFish?: boolean;
  /** 종료 결과에서는 경과 시간으로 추정하지 않고 정산된 마리 수를 쓴다. */
  caughtFish?: number;
  /** 사건마다 한 번만 성공 알림 reel 모션을 시작하는 멱등 토큰. */
  goldenCatchToken?: string | null;
  motion?: CatMotionInput;
  catchVisible?: boolean;
  catchVisibleSpots?: Spot[];
  catchGramVisible?: boolean;
  catchFuturePeerSpots?: Spot[];
  onMotionFinish?: () => void;
  generation?: number;
  animatedPosition?: {
    left: Animated.AnimatedInterpolation<number> | Animated.Value;
    top: Animated.AnimatedInterpolation<number> | Animated.Value;
  };
  catchAvoidSpots?: Spot[];
  /** 내 고양이의 장착 그림(GROMO-2382). */
  outfit?: Outfit;
}) {
  const [reeling, setReeling] = useState(false),
    [goldenReeling, setGoldenReeling] = useState(false),
    // 한 마리 잡을 때마다 올린다. 2초 창 안에서 또 잡아도 키 포즈·몸 변환·물보라를 처음부터 다시 튼다.
    [reelNonce, setReelNonce] = useState(0),
    // 연출 도중 덮이거나(inert) 백그라운드로 끊긴 사건. 돌아와도 그 사건의 연출은 다시 틀지 않는다.
    [interruptedNonce, setInterruptedNonce] = useState<number | null>(null);
  const count = caughtFish ?? Math.floor(seconds / SECONDS_PER_FISH) + (tutorialFish ? 1 : 0),
    last = useRef(count),
    // 이미 표시된 더미를 가진 채 재마운트되면 기존 사건을 새 당첨으로 재생하지 않는다.
    lastGoldenCatch = useRef<string | null>(goldenCatchToken ?? null);
  // 새로 한 마리 잡으면 2초 동안 낚아올리기
  useEffect(() => {
    if (count <= last.current) {
      last.current = count;
      setReeling(false);
      return;
    }
    last.current = count;
    if (reduce) {
      setReeling(false);
      return;
    }
    setReeling(true);
    setReelNonce((n) => n + 1);
    return afterForegroundMs(() => setReeling(false), 2000);
  }, [count, reduce]);
  // 컷신이 닫힌 뒤 참여자만 기존 낚아올리기 스프라이트로 한 번 알린다.
  useEffect(() => {
    if (goldenFishCount <= 0 || !goldenCatchToken) {
      setGoldenReeling(false);
      return;
    }
    if (reduce) {
      lastGoldenCatch.current = goldenCatchToken;
      setGoldenReeling(false);
      return;
    }
    if (lastGoldenCatch.current === goldenCatchToken) return;
    lastGoldenCatch.current = goldenCatchToken;
    setGoldenReeling(true);
    return afterForegroundMs(() => setGoldenReeling(false), 2000);
  }, [goldenFishCount, goldenCatchToken, reduce]);
  const sceneActive = useContext(FishingSceneActive),
    [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription?.remove();
  }, []);
  // 황금 물고기 reel 은 기존 100ms 반복 그대로 두고, 일반 낚시 연출(키 포즈·몸 변환·물보라)은 끈다.
  const isFishing = goldenReeling || !motion || motion === 'focus' || motion === 'reel',
    reelEvent = isFishing && !goldenReeling && (motion === 'reel' || (motion == null && reeling)),
    // 덮인 채/백그라운드로 시작한 사건은 effect 를 기다리지 않고 첫 렌더부터 끊긴 것으로 본다.
    running = isFishing && !goldenReeling && !reduce && sceneActive && appState === 'active',
    interrupted = reelEvent && (interruptedNonce === reelNonce || (!reduce && !running)),
    // 끊긴 사건은 남은 창 동안 기존 기본 reel(100ms 반복)로 두고, 끝나면 focus 키 포즈로 돌아간다.
    keyed = isFishing && !goldenReeling && !interrupted,
    catching = reelEvent && !interrupted;
  const pose = useFishingPose({
    active: isFishing && !goldenReeling && !reduce && sceneActive,
    catching,
    nonce: reelNonce,
  });
  // 일반 사건 창은 황금 reel 이 끼어드는 동안에도 흐른다(황금 여부와 무관하게 센다).
  const eventWindow = isFishing && (motion === 'reel' || (motion == null && reeling));
  useEffect(() => {
    // 황금 reel 이 일반 사건 창을 덮으면 그 사건은 끊긴 것으로 기록한다(황금 뒤 창이 남아도 처음부터 다시 틀지 않는다).
    if (goldenReeling) {
      if (eventWindow) setInterruptedNonce(reelNonce);
      return;
    }
    // 황금 구간엔 기록을 보존한다. 황금이 아닌데 사건이 없으면 비운다(부모가 motion='reel' 을 줄 땐 nonce 가 안 올라 같은 nonce 가 재사용된다).
    if (!reelEvent) setInterruptedNonce(null);
    else if (!reduce && !running) setInterruptedNonce(reelNonce);
  }, [goldenReeling, eventWindow, reelEvent, reduce, running, reelNonce]);
  const a = size * 0.077,
    face = spot.face,
    rodTip = castLineStart(spot),
    launch = {
      x: (size * (rodTip.x - spot.x)) / 100 + a / 2,
      y: (sizeY * (rodTip.y - spot.y)) / 100 + a * 0.90625,
    },
    catchPlacement = fishingCatchPlacement(
      spot,
      catchAvoidSpots,
      catchVisibleSpots,
      catchGramVisible,
      catchFuturePeerSpots,
    ),
    showsCatch = count > 0 && catchVisible && catchPlacement != null;
  // 화면 가장자리 자리의 머리 위 말풍선·이름이 반쯤 잘리지 않게 민다. 걷는 중에는 몸이 자리(spot)에 없어 밀지 않는다
  const visibleX = useContext(FishingVisibleX),
    // 글자는 OS 접근성 글자 배율만큼 커진다 — 폭 추정에도 곱한다
    fontScale = visibleX?.fontScale ?? 1,
    footX = (size * spot.x) / 100,
    pushIn = (w: number) =>
      visibleX && motion !== 'walk'
        ? keepLabelInView(footX, w, visibleX.lo, visibleX.hi) - footX
        : 0,
    // 말풍선은 maxWidth 120 을 넘지 않는다. 이름 글자 폭 대략값: 11px 한 자 ≈ 11px
    labelShift = pushIn(Math.min(120, labelWidth(emote ? '' : (subject ?? '')) * fontScale)),
    nameShift = pushIn([...name].length * nameText(me).fontSize * fontScale);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        // 걷는 주민(animatedPosition)은 left/top 대신 네이티브 드라이버 transform 으로 옮긴다(GROMO-2374).
        left: animatedPosition ? 0 : (size * spot.x) / 100 - a / 2,
        top: animatedPosition ? 0 : (sizeY * spot.y) / 100 - a * 0.90625,
        transform: animatedPosition
          ? [{ translateX: animatedPosition.left }, { translateY: animatedPosition.top }]
          : undefined,
        width: a,
        height: a,
        zIndex:
          20 +
          Math.round(
            showsCatch && catchPlacement
              ? Math.max(
                  spot.y,
                  spot.y + (catchPlacement.top - 0.90625 + fishingCatchFrame.height) * 0.077 * 150,
                )
              : spot.y,
          ),
      }}
    >
      {showsCatch && catchPlacement && (
        <Image
          source={assets[catchAssetPath(count)]}
          resizeMode="contain"
          testID="fishing-actor-catch"
          style={{
            position: 'absolute',
            left: catchPlacement.left * a,
            top: catchPlacement.top * a,
            width: a * 1.1,
            height: a * 1.1,
          }}
        />
      )}
      <CatSprite
        color={color}
        motion={goldenReeling ? 'reel' : (motion ?? (reeling ? 'reel' : 'focus'))}
        size={a}
        left={face < 0}
        reduce={reduce}
        anchored={false}
        onFinish={onMotionFinish}
        generation={generation}
        keyPoses={keyed}
        replayKey={keyed ? reelNonce : undefined}
        poseTransform={keyed ? pose.body : undefined}
        outfit={outfit}
        testID="fishing-actor-cat"
      />
      {isFishing && (
        <Image
          source={assets['props/fishing/fishing-rod.png']}
          resizeMode="contain"
          testID="fishing-actor-rod"
          style={rodStyle(spot, a)}
        />
      )}
      {/* DESIGN.md §8.3: 다른 주민의 물고기 획득은 공개하지 않는다 — 물보라·물고기는 내 고양이만. */}
      {me && catching && !reduce && sceneActive && spot.bx != null && spot.by != null && (
        <FishingCatchMotion
          key={reelNonce}
          reel={pose.reel}
          k={a / LAB_CAT_PX}
          face={face < 0 ? -1 : 1}
          launch={launch}
          bob={{
            x: (size * (spot.bx - spot.x)) / 100 + a / 2,
            y: (sizeY * (spot.by - spot.y)) / 100 + a * 0.90625,
          }}
          home={
            showsCatch && catchPlacement
              ? {
                  x: (catchPlacement.left + fishingCatchFrame.width / 2) * a,
                  y: (catchPlacement.top + fishingCatchFrame.height / 2) * a,
                }
              : null
          }
        />
      )}
      <View
        testID="fishing-actor-label"
        style={{
          position: 'absolute',
          bottom: a * 1.05,
          left: a / 2 - 100 + labelShift,
          width: 200,
        }}
        pointerEvents="none"
      >
        {/* 이모티콘이 오면 3초 동안 과목·시간표 자리를 대신한다(축소해 이름만 보이는 배율에서도 뜬다) */}
        {emote ? (
          <FocusEmoteBubble emote={emote} />
        ) : (
          subject != null && (
            <View
              style={{
                alignSelf: 'center',
                maxWidth: 120,
                backgroundColor: '#FFFDFAB8',
                borderRadius: 10,
                paddingVertical: 4,
                paddingHorizontal: 8,
              }}
            >
              <Text numberOfLines={1} style={label}>
                {subject}
              </Text>
              <Text style={[label, { fontWeight: '900', fontVariant: ['tabular-nums'] }]}>
                {hms(seconds)}
              </Text>
            </View>
          )
        )}
      </View>
      <View
        testID="fishing-actor-name"
        style={{ position: 'absolute', top: a * 0.98, left: a / 2 - 100 + nameShift, width: 200 }}
      >
        <Text style={[nameText(me), { textAlign: 'center' }]}>{name}</Text>
      </View>
      {Array.from({ length: Math.min(goldenFishCount, 3) }, (_, index) => (
        <Image
          key={index}
          source={art['fish/gold']}
          resizeMode="contain"
          accessible={false}
          testID={`fishing-actor-golden-fish-${index}`}
          style={{
            position: 'absolute',
            zIndex: 2 + index,
            left: -a * (0.62 - index * 0.12),
            bottom: a * (0.04 + index * 0.1),
            width: a * 0.48,
            height: a * 0.48,
          }}
        />
      ))}
    </Animated.View>
  );
}

/** 실시간 주민: 자리 배정 훅의 경로/상태를 스프라이트 모션으로 표현한다. */
export function FishingPeerActorView({
  actor,
  outfit,
  size,
  sizeY,
  emote,
  reduce,
  goldenFishCount,
  goldenCatchToken,
  onEntered,
  onCast,
  onPausedExit,
  onStretch,
  onCompletedExit,
  onPress,
}: {
  actor: import('@/screens/focus/useFishingPeerActors').FishingPeerActor;
  /** 남의 고양이 머리·목(GROMO-2390). */
  outfit?: Outfit;
  size: number;
  sizeY: number;
  emote?: string | null;
  reduce: boolean;
  goldenFishCount?: number;
  goldenCatchToken?: string | null;
  onEntered: (key: string, generation: number) => void;
  onCast: (key: string, generation: number) => void;
  onPausedExit: (key: string, generation: number) => void;
  onStretch: (key: string, generation: number) => void;
  onCompletedExit: (key: string, generation: number) => void;
  /** 누르면 정보창(GROMO-2474). 없으면 지금처럼 누를 수 없다. */
  onPress?: () => void;
}) {
  const { Animated: NativeAnimated } = require('react-native');
  const left = useRef(
    new NativeAnimated.Value((size * actor.position.x) / 100 - (size * 0.077) / 2),
  ).current;
  const top = useRef(
    new NativeAnimated.Value((sizeY * actor.position.y) / 100 - size * 0.077 * 0.90625),
  ).current;
  // 확대 중에도 픽셀 좌표가 어느 지도 크기 기준인지 기억해 중단된 이동 위치를 보존한다.
  const pixelSize = useRef({ size, sizeY });
  const motionToken = useRef(actor.generation);
  const [walkFace, setWalkFace] = useState(actor.spot.face);
  useEffect(() => {
    const token = actor.generation;
    motionToken.current = token;
    const toPoint =
      actor.phase === 'entering' ||
      actor.phase === 'leaving-pause' ||
      actor.phase === 'leaving-complete'
        ? actor.phase === 'entering'
          ? actor.spot
          : LANDING
        : actor.position;
    const toLeft = (size * toPoint.x) / 100 - (size * 0.077) / 2;
    const toTop = (sizeY * toPoint.y) / 100 - size * 0.077 * 0.90625;
    if (
      actor.phase === 'entering' ||
      actor.phase === 'leaving-pause' ||
      actor.phase === 'leaving-complete'
    ) {
      if (reduce) {
        left.setValue(toLeft);
        top.setValue(toTop);
        pixelSize.current = { size, sizeY };
        if (actor.phase === 'entering') onEntered(actor.key, token);
        else if (actor.phase === 'leaving-pause') onPausedExit(actor.key, token);
        else onCompletedExit(actor.key, token);
        return;
      }
      let movement: {
          start: (callback: (result: { finished: boolean }) => void) => void;
          stop: () => void;
        } | null = null,
        cancelled = false;
      // 이전 방향의 composite가 cleanup에서 멈춘 실제 픽셀 좌표를 읽어 새 땅 경로를 계산한다.
      // actor.position은 상태 경계 좌표라 이동 도중 방향이 바뀐 경우의 현재 위치가 아니다.
      // 네이티브 드라이버 값이라 stopAnimation 콜백은 네이티브 왕복 뒤에 온다(GROMO-2374) — 그 사이 정리는 cancelled 가 막는다.
      const fromSize = pixelSize.current;
      left.stopAnimation((currentLeft: number) => {
        top.stopAnimation((currentTop: number) => {
          if (cancelled) return;
          const current = peerPointFromPixels(
              currentLeft,
              currentTop,
              fromSize.size,
              fromSize.sizeY,
            ),
            route = peerLandRoute(current, toPoint),
            waypoints = route.length ? route : [toPoint];
          // 멈춘 지도 좌표를 새 확대 배율의 픽셀로 옮긴 뒤 남은 경로를 이어간다.
          const rebased = peerPixelsAtSize(
            currentLeft,
            currentTop,
            fromSize.size,
            fromSize.sizeY,
            size,
            sizeY,
          );
          left.setValue(rebased.left);
          top.setValue(rebased.top);
          pixelSize.current = { size, sizeY };
          let previous = current,
            index = 0,
            face = actor.spot.face;
          const finish = () => {
            if (actor.phase === 'entering') onEntered(actor.key, token);
            else if (actor.phase === 'leaving-pause') onPausedExit(actor.key, token);
            else onCompletedExit(actor.key, token);
          };
          const step = () => {
            if (cancelled || motionToken.current !== token) return;
            const point = waypoints[index],
              distance = Math.hypot(previous.x - point.x, ((previous.y - point.y) * 2) / 3),
              duration = Math.max(32, Math.round(distance * 35));
            face = peerWalkFace(previous, point, face);
            setWalkFace(face);
            const segment = NativeAnimated.parallel([
              NativeAnimated.timing(left, {
                toValue: (size * point.x) / 100 - (size * 0.077) / 2,
                duration,
                ...NATIVE,
              }),
              NativeAnimated.timing(top, {
                toValue: (sizeY * point.y) / 100 - size * 0.077 * 0.90625,
                duration,
                ...NATIVE,
              }),
            ]);
            movement = segment;
            segment.start(({ finished }: { finished: boolean }) => {
              if (!finished || cancelled || motionToken.current !== token) return;
              previous = point;
              index += 1;
              if (index < waypoints.length) step();
              else finish();
            });
          };
          step();
        });
      });
      return () => {
        cancelled = true;
        movement?.stop();
      };
    }
    if (actor.phase === 'finishing') {
      // 이동을 마치기 전 완료되면 cleanup이 멈춘 실제 위치에서 기지개를 시작한다.
      if (pixelSize.current.size !== size || pixelSize.current.sizeY !== sizeY) {
        const fromSize = pixelSize.current;
        left.stopAnimation((currentLeft: number) => {
          top.stopAnimation((currentTop: number) => {
            // 콜백이 비동기라(네이티브 드라이버) 그 사이 다음 단계가 시작됐으면 그 자리를 덮지 않는다.
            if (motionToken.current !== token) return;
            const rebased = peerPixelsAtSize(
              currentLeft,
              currentTop,
              fromSize.size,
              fromSize.sizeY,
              size,
              sizeY,
            );
            left.setValue(rebased.left);
            top.setValue(rebased.top);
            pixelSize.current = { size, sizeY };
          });
        });
      } else {
        left.stopAnimation();
        top.stopAnimation();
      }
    } else {
      left.setValue(toLeft);
      top.setValue(toTop);
      pixelSize.current = { size, sizeY };
    }
  }, [
    actor.key,
    actor.generation,
    actor.phase,
    actor.position.x,
    actor.position.y,
    actor.spot.x,
    actor.spot.y,
    size,
    sizeY,
    reduce,
    onEntered,
    onPausedExit,
    onCompletedExit,
    left,
    top,
  ]);

  if (!actor.visible) return null;
  const motion =
    actor.phase === 'entering' ||
    actor.phase === 'leaving-pause' ||
    actor.phase === 'leaving-complete'
      ? 'walk'
      : actor.phase === 'casting'
        ? 'cast'
        : actor.phase === 'finishing'
          ? 'stretch'
          : undefined;
  const spriteSpot = motion === 'walk' ? { ...actor.spot, face: walkFace } : actor.spot;
  const a = size * 0.077,
    touch = Math.max(semanticTokens.size.tapMin, a);
  return (
    <>
      <FishingActor
        spot={spriteSpot}
        size={size}
        sizeY={sizeY}
        color={actor.color}
        outfit={outfit}
        name={actor.name}
        subject={actor.subject}
        seconds={actor.seconds}
        emote={emote}
        reduce={reduce}
        goldenFishCount={goldenFishCount}
        goldenCatchToken={goldenCatchToken}
        motion={motion}
        catchVisible={fishingPeerCatchVisible(actor)}
        onMotionFinish={
          actor.phase === 'casting'
            ? () => onCast(actor.key, actor.generation)
            : actor.phase === 'finishing'
              ? () => onStretch(actor.key, actor.generation)
              : undefined
        }
        generation={actor.generation}
        animatedPosition={{ left, top }}
      />
      {/* 누르는 자리는 그림(눌리지 않음)과 따로 둔다 — 이름표가 바다 누르기(자리 고르기)를 가리지 않게 고양이 몸 위 44pt 만 */}
      {onPress && (
        <NativeAnimated.View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: a,
            height: a,
            zIndex: 20 + Math.round(actor.spot.y),
            transform: [{ translateX: left }, { translateY: top }],
          }}
        >
          <Pressable
            testID={`fishing-peer-${actor.userId}`}
            accessibilityRole="button"
            accessibilityLabel={t('catInfo.open', { name: actor.name })}
            onPress={onPress}
            style={{
              position: 'absolute',
              left: (a - touch) / 2,
              top: (a - touch) / 2,
              width: touch,
              height: touch,
            }}
          />
        </NativeAnimated.View>
      )}
    </>
  );
}
/** 정보창(GROMO-2474)의 낚시 고양이 — 낚시 자리와 같은 낚시 자세·낚싯대를 멈춘 채 그린다. */
export function FishingCatArt({
  spot,
  color,
  outfit,
  size,
}: {
  spot: Spot;
  color: Color;
  outfit?: Outfit;
  size: number;
}) {
  return (
    <View style={{ width: size, height: size }}>
      <CatSprite
        color={color}
        motion="focus"
        size={size}
        left={spot.face < 0}
        reduce
        anchored={false}
        outfit={outfit}
      />
      <Image
        source={assets['props/fishing/fishing-rod.png']}
        resizeMode="contain"
        style={rodStyle(spot, size)}
      />
    </View>
  );
}
// 서 있거나 걷는 내 고양이(fi-walker): 낚시 고양이와 같은 크기·발 기준점, 걷는 동안만 걷기 그림.
export function FishingWalker({
  p,
  size,
  sizeY,
  color,
  walking,
  left,
  reduce,
  outfit,
  name,
}: {
  name: string;
  p: Point;
  size: number;
  sizeY: number;
  color: Color;
  walking: boolean;
  left: boolean;
  reduce: boolean;
  outfit?: Outfit;
}) {
  const a = size * 0.077;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (size * p.x) / 100,
        top: (sizeY * p.y) / 100,
        zIndex: 20 + Math.round(p.y),
      }}
    >
      <CatSprite
        color={color}
        size={a}
        motion={walking ? 'walk' : 'idle'}
        left={left}
        reduce={reduce}
        outfit={outfit}
      />
      <View style={{ position: 'absolute', top: a * (0.98 - 0.90625), left: -100, width: 200 }}>
        <Text style={[nameText(true), { textAlign: 'center' }]}>{name}</Text>
      </View>
    </View>
  );
}
// 낚시섬 화면 버튼(fi-root button): 알약형 · 갈색 2px 윤곽 · 아래 4px 그림자 · 누르면 3px 내려앉음
export function FiButton({
  title,
  onPress,
  id,
  primary = false,
  small = false,
  left = false,
  bg,
  style,
  holdToConfirm = false,
  haptics = true,
  multiline = false,
}: {
  title: string;
  onPress: () => void;
  id?: string;
  primary?: boolean;
  small?: boolean;
  left?: boolean;
  bg?: string;
  style?: any;
  holdToConfirm?: boolean;
  haptics?: boolean;
  multiline?: boolean;
}) {
  const holdProgress = useRef(new Animated.Value(0)).current;
  const holding = useRef(false);
  const holdSource = useRef<'touch' | 'accessibility' | null>(null);
  const [accessibleHolding, setAccessibleHolding] = useState(false);
  const finishAction = useRef(onPress);
  finishAction.current = onPress;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = useCallback(() => {
    holding.current = false;
    holdSource.current = null;
    setAccessibleHolding(false);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (pulseTimer.current) clearInterval(pulseTimer.current);
    pulseTimer.current = null;
    holdProgress.stopAnimation();
    holdProgress.setValue(0);
  }, [holdProgress]);
  useEffect(() => {
    if (!holdToConfirm) return;
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stopHold();
    });
    return () => {
      listener.remove();
      stopHold();
    };
  }, [holdToConfirm, stopHold]);
  const completeHold = () => {
    if (!holding.current) return;
    stopHold();
    holdProgress.setValue(1);
    finishAction.current();
  };
  const startHold = (source: 'touch' | 'accessibility') => {
    stopHold();
    holding.current = true;
    holdSource.current = source;
    setAccessibleHolding(source === 'accessibility');
    // RN longPress는 버튼 안에서 손가락이 조금 움직여도 취소된다. 누름이 유지되는 시간을 직접 잰다.
    holdTimer.current = setTimeout(completeHold, componentTokens.focusEndHold.durationMs);
    Animated.timing(holdProgress, {
      toValue: 1,
      duration: componentTokens.focusEndHold.durationMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
    if (haptics && Platform.OS !== 'web') {
      const pulse = () =>
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      pulse();
      pulseTimer.current = setInterval(pulse, componentTokens.focusEndHold.hapticIntervalMs);
    }
  };
  const activateAccessibleHold = () => {
    if (holdSource.current === 'accessibility') {
      stopHold();
      return;
    }
    startHold('accessibility');
    AccessibilityInfo.announceForAccessibility(t('focusFlow.common.holdEndStarted'));
  };
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={accessibleHolding ? t('focusFlow.common.holdEndCancel') : title}
      accessibilityHint={
        holdToConfirm
          ? t(
              accessibleHolding
                ? 'focusFlow.common.holdEndCancelHint'
                : 'focusFlow.common.holdEndA11yHint',
            )
          : undefined
      }
      accessibilityActions={
        holdToConfirm
          ? [
              {
                name: 'activate',
                label: t(
                  accessibleHolding
                    ? 'focusFlow.common.holdEndCancel'
                    : 'focusFlow.common.holdEndStart',
                ),
              },
            ]
          : undefined
      }
      onAccessibilityTap={holdToConfirm ? activateAccessibleHold : undefined}
      onAccessibilityAction={
        holdToConfirm
          ? ({ nativeEvent }) => {
              if (nativeEvent.actionName === 'activate') activateAccessibleHold();
            }
          : undefined
      }
      onPress={holdToConfirm ? undefined : onPress}
      onPressIn={
        holdToConfirm
          ? () => {
              if (holdSource.current !== 'accessibility') startHold('touch');
            }
          : undefined
      }
      onPressOut={
        holdToConfirm
          ? () => {
              if (holdSource.current === 'touch') stopHold();
            }
          : undefined
      }
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingVertical: small ? 8 : 10,
          paddingHorizontal: small ? 11 : 15,
          borderRadius: 999,
          borderWidth: 2,
          borderColor: OUTLINE,
          backgroundColor: holdToConfirm ? C.cream : (bg ?? (primary ? C.pink : C.cream)),
          overflow: holdToConfirm ? 'hidden' : undefined,
          boxShadow: `0px ${pressed ? 1 : 4}px 0px ${OUTLINE}`,
          transform: [{ translateY: pressed ? 3 : 0 }],
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {holdToConfirm && (
        <Animated.View
          testID={id ? `${id}-progress` : undefined}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            right: 0,
            transform: [{ scaleX: holdProgress }],
            transformOrigin: 'left center',
            backgroundColor: componentTokens.focusEndHold.fill,
          }}
        />
      )}
      <Text
        numberOfLines={multiline ? undefined : 1}
        style={{
          fontSize: small ? 11 : 14,
          lineHeight: small ? 14.3 : 18.2,
          fontWeight: '900',
          color: INK,
          textAlign: left ? 'left' : 'center',
        }}
      >
        {holdToConfirm ? t('focusFlow.common.holdEndFocus') : title}
      </Text>
    </Pressable>
  );
}
// 낚시섬 모달(fi-modal): 반투명 막 위 가운데 카드. 가로(폭 600 이상)는 오른쪽 330px.
// hidden: 위에 다른 모달(보상)이 떠 있을 때 — Android TalkBack은 형제 뷰를 자동으로 숨기지 않으므로 직접 숨긴다
export function FiModal({
  children,
  hidden,
  footer,
}: {
  children: React.ReactNode;
  hidden?: boolean;
  footer?: React.ReactNode;
}) {
  const wide = useAppLayout().width >= 600,
    safe = useSafeAreaInsets();
  const contentPadding = wide ? semanticTokens.spacing.page : semanticTokens.spacing.section;
  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 10, justifyContent: 'center' }]}
      accessibilityViewIsModal={!hidden}
      {...a11yHidden(!!hidden)}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3940' }]} />
      {/* 낮은 화면(가로 폰)에서 내용이 카드보다 길면 카드 안에서 스크롤한다 — 아래 버튼까지 닿는다 */}
      <View
        style={[
          fiCard,
          wide
            ? {
                alignSelf: 'flex-end',
                marginRight: Math.max(24, safe.right),
                width: 330,
                maxHeight: '94%',
              }
            : { marginHorizontal: 20, maxHeight: '85%' },
        ]}
      >
        <ScrollView
          style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ padding: contentPadding }}
          bounces={false}
        >
          {children}
        </ScrollView>
        {footer && (
          <View
            style={{
              paddingHorizontal: contentPadding,
              paddingBottom: contentPadding,
            }}
          >
            {footer}
          </View>
        )}
      </View>
    </View>
  );
}
export const fiCard = {
  backgroundColor: C.cream,
  borderWidth: 2,
  borderColor: OUTLINE,
  borderRadius: 26,
  boxShadow: `0px 5px 0px ${OUTLINE}`,
};
export const fiTitle = (size: number) => ({
  fontSize: size,
  lineHeight: size * 1.6,
  fontWeight: '900' as const,
  letterSpacing: -0.5,
  color: INK,
});
