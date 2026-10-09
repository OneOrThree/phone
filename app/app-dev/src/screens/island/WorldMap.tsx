import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Svg, { Defs, Pattern, Rect, Image as SvgImage } from 'react-native-svg';
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import {
  State,
  hasMailboxLetters,
  Route,
  Building,
  Color,
  currentIsland,
  homeIsland,
  serverHome,
  viewIsland,
  buildingNames,
  balance,
  isHost,
  buildingCost,
  buildMinutes,
  todayFocusSeconds,
} from '@/services/model';
import { assets, cat } from '@/constants/assets';
import { t } from '@/i18n';
import { CatSprite, CatMotionInput, interactiveMotionDurationMs } from '@/components/CatSprite';
import { buildStudyWidgetSnapshot, updateStudyWidget } from '@/services/studyWidget';
import {
  ConstructionBuildingSprite,
  type ConstructionPhase as ConstructionSpritePhase,
} from '@/components/ConstructionBuildingSprite';
import {
  claimableQuestRewardCount,
  HOME_QUEST_LIST_DETAIL,
  HomeQuestIndicator,
} from '@/screens/island/HomeQuestIndicator';
import { useAppLayout } from '@/utils/layout';
import { Grid, Point, onLand, nearestLand, landPath } from '@/utils/world-grid';
import grids from '@/constants/world-v2.json';
import legacyDoorCoords from '@/constants/legacy-doors.json';
import { Btn, C, Txt, Pic } from '@/design-system/patterns';
import { VillageScenery } from './VillageScenery';
import { ServerBuildCard } from './ServerBuildCard';
import { TileTerrainCanvas, navDebugText, type NavDebug, type NavWalk } from './TileTerrainCanvas';
import bundledNavJson from '@/assets/village-world/v1/nav.json';
import {
  demoteToBundle,
  type MapAssetSource,
  promoteMapAssets,
  readMapJson,
  syncMapAssets,
  type TilesetFile,
} from '@/services/mapAssets';
import { applyLayout, legacyLayoutOffsets } from '@/utils/island-layout';
import {
  loadNav,
  MS_PER_UNIT,
  navPath,
  stepDurationMs,
  tapToWorld,
  tilePath,
} from '@/utils/nav-path';
import { imageToWorld, worldToImage, type WorldPoint } from '@/utils/worldCoords';
import {
  publishMoveIntent,
  stompIslandChannel,
  type IslandChannel,
} from '@/services/islandRealtime';
import {
  createMovementController,
  remainingPath,
  sameCells,
  type MovementActor,
  type MovementCallbacks,
  type MovementController,
} from '@/services/movementSync';
import { villageAssets } from '@/constants/village-assets';
import {
  villageScene,
  villagePath,
  villageDoors,
  villageMap,
  VillageScene,
} from '@/utils/village-world';
import { semanticTokens } from '@/design-system/tokens';
import { componentTokens, primitiveTokens } from '@/design-system/tokens';
import { TutorialScene, TutorialSpotlight, useSpotlightTarget } from '@/screens/island/NpcGuide';
import { getSession } from '@/services/api/session';
import { catColor } from '@/screens/focus/useIslandPresence';
import {
  constructionPhase,
  normalizedConstructionProgress,
} from '@/screens/island/constructionProgress';
import {
  BUILDING_ENTRY_DURATION_MS,
  BUILDING_TRANSITION_DURATION_MS,
  BUILDING_SPRITE_LEAD_IN_MS,
  BUILDING_TRANSITION_ROUTE,
  createBuildingTransitionController,
  runBuildingEntryWalk,
  type BuildingTransitionState,
  type BuildingTransitionTarget,
} from '@/services/buildingTransition';
import { BuildingTransitionOverlay } from './BuildingTransitionOverlay';
import { VillageHallMotion } from '@/components/village-motion/VillageHallMotion';
import { VillageBoardIndicator } from '@/components/village-motion/VillageBoardIndicator';
import {
  VillageObservatoryMotion,
  type ObservatoryRankState,
} from '@/components/village-motion/VillageObservatoryMotion';
import { ShopMotion, type ShopMotionState } from '@/components/village-motion/ShopMotion';
import { LibraryMotion, type LibraryMotionState } from '@/components/village-motion/LibraryMotion';
import { FireMotion } from '@/components/village-motion/FireMotion';
import { RaftWaterMotion } from '@/components/village-motion/RaftWaterMotion';
import { VillageNotificationBadge } from '@/components/village-motion/VillageNotificationBadge';

// 타일 섬 지형(GROMO-2230): 켜면 기존 마을 홈 섬의 바닥을 Skia Atlas 로 그리고 탭·걷기를 v1/nav.json A* 로 한다.
// 새 마을 미리보기(layered)는 플래그와 무관하게 자기 지형 이미지·villagePath 를 그대로 쓴다.
// 웹은 canvaskit wasm 로딩이 필요해 이 티켓 밖 — 플래그를 무시하고 기존 Image 를 쓴다.
const TILE_ISLAND = Platform.OS !== 'web' && process.env.EXPO_PUBLIC_TILE_ISLAND === '1';
// 이동 동기화(GROMO-2248): 타일 섬 + 이 플래그 + 서버 홈일 때만 이동 채널을 열어 서버 확정 경로를 따른다.
// 서버가 없거나 거절하면 지금처럼 로컬로 걷고 주민은 Wanderer 로 돌아다닌다.
const MOVEMENT_SYNC = TILE_ISLAND && process.env.EXPO_PUBLIC_MOVEMENT_SYNC === '1';
// 타일 섬 = 플래그 + 기존 마을 홈 섬(새 마을 미리보기·낚시가 아님). 지형(WorldMap)과 걷기(FinalIslandScene)가
// 같은 판정을 쓰도록 한 곳에 둔다 — 갈라지면 지형은 타일인데 걷기는 landPath 가 된다.
const isTileIsland = (village: unknown, fishing = false) => TILE_ISLAND && !village && !fishing;
const BUNDLE_ASSETS: MapAssetSource = { kind: 'bundle' };
const pathDistance = (pts: readonly Point[]) => {
  let sum = 0;
  for (let idx = 1; idx < pts.length; idx++) {
    sum += Math.hypot(pts[idx].x - pts[idx - 1].x, pts[idx].y - pts[idx - 1].y);
  }
  return sum;
};
type WorldViewport = { left: number; top: number; scale: number };

export function createWorldProjector(getViewport: () => WorldViewport) {
  return (point: Point) => {
    const viewport = getViewport();
    return {
      x: viewport.left + point.x * viewport.scale,
      y: viewport.top + point.y * viewport.scale,
    };
  };
}
const layer: Record<Building, string> = {
  hall: 'hall',
  board: 'notice-board',
  gram: 'gramophone',
  library: 'library',
  mail: 'mailbox',
  tower: 'observatory',
  shop: 'shop',
};
const legacyBuildingLabelBox: Record<Building, { x: number; y: number; w: number }> = {
  hall: { x: 949, y: 21, w: 242 },
  board: { x: 856, y: 157, w: 80 },
  gram: { x: 330, y: 391, w: 73 },
  library: { x: 1120, y: 288, w: 239 },
  mail: { x: 298, y: 520, w: 46 },
  tower: { x: 150, y: 24, w: 112 },
  shop: { x: 456, y: 580, w: 262 },
};
const legacyBuildingLabelAnchorY: Record<Building, number> = {
  hall: 70,
  board: 157,
  gram: 365,
  library: 310,
  mail: 494,
  tower: 52,
  shop: 603,
};
const legacyBuildingLabelAnchorXOffset: Partial<Record<Building, number>> = {
  tower: -12,
};
const rightAlignedBuildingLabels = new Set<Building>(['hall', 'library', 'shop']);
type Door = Point & {
  r: Route;
  label: string;
  building?: Building;
  memberOnly?: boolean;
  visitorRoute?: Route;
  direct?: boolean;
  hitbox?: { x: number; y: number; w: number; h: number };
};
const NO_OFFSET: Point = { x: 0, y: 0 };
/** 타일 섬 서버 배치(GROMO-2227) — 건물별 평행이동(이미지 px). 없는 건물은 0. */
type BuildingOffsets = Partial<Record<Building, Point>>;
// 좌표·hitbox 숫자는 legacy-doors.json 한 곳(nav fixture 생성 스크립트와 공유). 라벨·경로만 여기서 붙인다.
// label 은 전부 게터다 — 모듈 최상위 상수지만 import 시점이 아니라 접근 시점(렌더 중)에 해석해
// buildingNames/t() 가 그때의 언어를 따르게 한다(buildingNames.hall 자체가 게터여도 여기서 평범한
// 필드로 한 번 읽어 담으면 그 즉시 고정값이 돼 버린다 — GROMO-2239 리뷰 지적).
export const legacyDoors: Record<string, Door> = (() => {
  const d = legacyDoorCoords.doors;
  // ⚠️ 여기서 `...d.hall` 처럼 스프레드를 쓰면 안 된다 — Babel 의 _objectSpread 가 같은 리터럴의 게터를
  // import 시점 값으로 복사해 라벨이 굳는다(Metro 도 같은 변환). 좌표는 필드로 옮겨 적는다.
  const building = (b: Building, r: Route, memberOnly?: boolean): Door => ({
    x: d[b].x,
    y: d[b].y,
    r,
    get label() {
      return buildingNames[b];
    },
    building: b,
    memberOnly,
  });
  return {
    hall: building('hall', 'hall'),
    board: building('board', 'board'),
    gram: building('gram', 'sound', true),
    library: building('library', 'library'),
    mail: building('mail', 'mail'),
    tower: building('tower', 'tower'),
    shop: building('shop', 'shop'),
    // 고양이는 부두 끝(x·y)까지 걸어가고, 탭 영역은 배경에 그려진 뗏목 위에 둔다. 기본 탭 영역은
    // 도착점 주변(부두의 육지 쪽 끝)이라 뗏목 그림을 눌러도 바다만 눌렀다(GROMO-2157).
    raft: {
      x: d.raft.x,
      y: d.raft.y,
      hitbox: d.raft.hitbox,
      r: 'boat',
      get label() {
        return t('home.a11y.raft');
      },
      memberOnly: true,
    },
    fishingIsland: {
      x: d.fishingIsland.x,
      y: d.fishingIsland.y,
      hitbox: d.fishingIsland.hitbox,
      r: 'focusVisit',
      get label() {
        return t('home.a11y.viewFishingIsland');
      },
      memberOnly: true,
      visitorRoute: 'visitIslandFocus',
      direct: true,
    },
  };
})();
type ConstructionPlacement = { x: number; y: number; w: number; h: number };
/** 기존 1536×1024 건물 레이어에서 투명 여백을 제외한 원본 rect의 bottom-center 좌표. */
const legacyConstructionPlacements: Readonly<Record<Building, ConstructionPlacement>> = {
  hall: { x: 1070, y: 265, w: 242, h: 244 },
  board: { x: 896, y: 237, w: 80, h: 80 },
  gram: { x: 366.5, y: 480, w: 73, h: 89 },
  library: { x: 1239.5, y: 611, w: 239, h: 323 },
  mail: { x: 321, y: 583, w: 46, h: 63 },
  tower: { x: 206, y: 217, w: 112, h: 193 },
  shop: { x: 587, y: 779, w: 262, h: 199 },
};

export function constructionPlacement(
  building: Building,
  layeredPreview: boolean,
): ConstructionPlacement | undefined {
  return layeredPreview
    ? villageMap.objects.find((object) => object.building === building)
    : legacyConstructionPlacements[building];
}

// label 과 같은 이유로 게터 — 모듈 최상위 상수지만 접근 시점에 t() 를 부른다.
const constructionPhaseLabels: Readonly<Record<ConstructionSpritePhase, string>> = {
  get foundation() {
    return t('home.construction.foundation');
  },
  get structure() {
    return t('home.construction.structure');
  },
  get finishing() {
    return t('home.construction.finishing');
  },
  get completion() {
    return t('home.construction.completion');
  },
};
const homePositions: Record<string, Point> = {};
// 섬을 돌아다니는 주민 고양이 두 마리의 출발 자리(모닥불 근처 땅)
const WANDER_STARTS: Point[] = [
  { x: 470, y: 560 },
  { x: 720, y: 520 },
];
// 주민 고양이: 내 고양이와 다른 색으로, 근처 땅을 골라 걸어갔다 잠시 쉬기를 되풀이한다 (연출 전용, 상태 없음)
function Wanderer({
  color,
  start,
  s,
  reduce,
  delay,
  scene,
  assets,
  buildings,
}: {
  color: Color;
  start: Point;
  s: number;
  reduce: boolean;
  delay: number;
  scene?: VillageScene;
  assets: MapAssetSource;
  buildings: readonly string[];
}) {
  const xy = useRef(new Animated.ValueXY(start)).current,
    at = useRef(start);
  const [walking, setWalking] = useState(false),
    [left, setLeft] = useState(false),
    [depth, setDepth] = useState(start.y);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const roam = () => {
      if (!alive) return;
      // 지금 자리에서 ±200·±150px 안의 땅 한 곳으로, 최대 14칸까지만 걷는다
      const target = nearestLand(scene?.grid ?? grids.home, {
        x: at.current.x + Math.random() * 400 - 200,
        y: at.current.y + Math.random() * 300 - 150,
      });
      const size = sizeOf(grids.home);
      const path = (
        scene
          ? villagePath(scene, at.current, target)
          : TILE_ISLAND
            ? [
                at.current,
                ...navPath(
                  activeNav(assets, buildings),
                  imageToWorld(at.current, size),
                  imageToWorld(target, size),
                ).map((n) => worldToImage(n, size)),
              ]
            : landPath(grids.home, at.current, target)
      ).slice(1, 15);
      if (!path.length) {
        timer = setTimeout(roam, 1500);
        return;
      }
      setLeft(path[path.length - 1].x < at.current.x);
      setWalking(true);
      let idx = 0;
      const step = () => {
        if (!alive) return;
        if (idx >= path.length) {
          setWalking(false);
          timer = setTimeout(roam, 2000 + Math.random() * 4000);
          return;
        }
        const next = path[idx++];
        Animated.timing(xy, {
          toValue: next,
          duration: reduce ? 0 : 130,
          easing: Easing.linear,
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (!finished) return;
          at.current = next;
          setDepth(next.y);
          step();
        });
      };
      step();
    };
    timer = setTimeout(roam, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
      xy.stopAnimation();
    };
  }, [scene, reduce, assets]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: Animated.multiply(xy.x, s),
        top: Animated.multiply(xy.y, s),
        zIndex: scene ? Math.round(depth) : undefined,
      }}
    >
      <CatSprite
        color={color}
        size={70 * s}
        motion={walking ? 'walking' : 'blink'}
        left={left}
        reduce={reduce}
      />
    </Animated.View>
  );
}
type RemoteListener = (p: Point, moving: boolean, durationMs: number) => void;
// 다른 주민(GROMO-2248): 배회 대신 서버가 정한 위치(100ms 늦춰 경로 위로 보간한 값)만 받아 그린다.
// 위치는 React state 가 아니라 Animated 값으로만 옮긴다(20Hz setState 금지) — 자세·방향만 바뀔 때 state.
function RemoteResident({
  userId,
  color,
  start,
  s,
  reduce,
  subscribe,
}: {
  userId: string;
  color: Color;
  start: Point;
  s: number;
  reduce: boolean;
  subscribe: (userId: string, listener: RemoteListener) => () => void;
}) {
  const xy = useRef(new Animated.ValueXY(start)).current,
    at = useRef(start);
  const [walking, setWalking] = useState(false),
    [left, setLeft] = useState(false);
  useEffect(() => {
    let stop: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe(userId, (p, moving, durationMs) => {
      if (Math.abs(p.x - at.current.x) > 0.5) setLeft(p.x < at.current.x);
      at.current = p;
      setWalking(moving);
      // 위치가 300ms 넘게 안 오면 제자리걸음을 멈춘다(계약 §3 — 끊기면 마지막 위치에 정지).
      clearTimeout(stop);
      if (moving) stop = setTimeout(() => setWalking(false), 300);
      // durationMs 는 보간에 쓴 두 샘플의 틱 간격 기반 — 저주기 스냅샷도 다음 호출까지 매끄럽게 잇는다.
      Animated.timing(xy, {
        toValue: p,
        duration: reduce ? 0 : durationMs,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    });
    return () => {
      unsubscribe();
      clearTimeout(stop);
      xy.stopAnimation();
    };
  }, [userId, subscribe, reduce, xy]);
  return (
    <Animated.View
      testID={`remote-resident-${userId}`}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: Animated.multiply(xy.x, s),
        top: Animated.multiply(xy.y, s),
      }}
    >
      <CatSprite
        color={color}
        size={70 * s}
        motion={walking ? 'walking' : 'blink'}
        left={left}
        reduce={reduce}
      />
    </Animated.View>
  );
}
export type VillageDayNight = 'day' | 'night';

const localDayNight = (): VillageDayNight => {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? 'day' : 'night';
};

/** 기기 현지 시각의 낮(06~18시)·밤. 웹 데모 쿼리 ?demo&night 로 고정할 수 있다. */
export function useVillageDayNight(): VillageDayNight {
  const demoParams =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null;
  const demo = demoParams?.has('demo') === true;
  const demoNight = demo && demoParams!.has('night');
  const [dayNight, setDayNight] = useState<VillageDayNight>(() =>
    demo ? (demoNight ? 'night' : 'day') : localDayNight(),
  );
  useEffect(() => {
    if (demo) return;
    const timer = setInterval(() => setDayNight(localDayNight()), 60_000);
    return () => clearInterval(timer);
  }, [demo]);
  return dayNight;
}

export function WorldMap({
  state,
  islandId,
  fishing = false,
  onSpot,
  emote,
  showMailboxLetters,
  hallMotionActive = false,
  hallMotionGeneration = 0,
  boardStatus = null,
  observatoryRankState = 'normal',
  shopState = 'normal',
  libraryState = 'normal',
  libraryArrivalActive = false,
  libraryArrivalGeneration = 0,
  towerArrivalActive = false,
  towerArrivalGeneration = 0,
  shopArrivalActive = false,
  shopArrivalGeneration = 0,
  village,
  hiddenVillageBuilding,
  dayNight: dayNightProp,
  mapAssets = BUNDLE_ASSETS,
  onMapAssetsFail,
  navDebug,
  buildingOffsets,
  children,
}: {
  state: State;
  islandId?: string;
  fishing?: boolean;
  onSpot?: (p: Point) => void;
  emote?: string | null;
  showMailboxLetters?: boolean;
  hallMotionActive?: boolean;
  hallMotionGeneration?: number;
  boardStatus?: 'unread' | 'new-comment' | null;
  observatoryRankState?: ObservatoryRankState;
  shopState?: ShopMotionState;
  libraryState?: LibraryMotionState;
  libraryArrivalActive?: boolean;
  libraryArrivalGeneration?: number;
  towerArrivalActive?: boolean;
  towerArrivalGeneration?: number;
  shopArrivalActive?: boolean;
  shopArrivalGeneration?: number;
  village?: VillageScene;
  hiddenVillageBuilding?: Building;
  /** 부모가 같은 낮·밤 판정으로 진입 모션을 조율할 때 넘긴다. 없으면 직접 계산한다. */
  dayNight?: VillageDayNight;
  /** 이 화면의 맵 에셋 스냅샷(GROMO-2233). 지형 이미지·tilemap·nav·layout 이 모두 이 소스를 쓴다. */
  mapAssets?: MapAssetSource;
  /** 캐시 이미지 디코드 실패 — 부모가 스냅샷을 번들로 바꾼다. */
  onMapAssetsFail?: (file: TilesetFile) => void;
  /** 개발 전용 이동 보기(타일 섬만). */
  navDebug?: NavDebug | null;
  /** 타일 섬 서버 배치 — 기존 마을 건물 레이어·모션·알림을 이만큼 옮겨 그린다. */
  buildingOffsets?: BuildingOffsets;
  children?:
    React.ReactNode | ((scale: number, project: (point: Point) => Point) => React.ReactNode);
}) {
  const L = useAppLayout(),
    grid: Grid = fishing ? grids.fishing : (village?.grid ?? grids.home),
    island = state.islands.find((item) => item.id === islandId) ?? homeIsland(state);
  // 타일 섬 지형 캔버스는 기존 마을 홈 섬 + 플래그일 때만. 낚시·새 마을 미리보기는 기존 Image 그대로.
  const tileTerrain = isTileIsland(village, fishing);
  const ownDayNight = useVillageDayNight();
  const dayNight = dayNightProp ?? ownDayNight;
  const mailboxLetters = !fishing && (showMailboxLetters ?? hasMailboxLetters(state, island.id));
  const [camera, setCamera] = useState({
    x: fishing ? 512 : village ? 800 : 585,
    y: fishing ? 770 : village ? 510 : 430,
    z: 1,
  });
  // 홈 카메라: v2 시안 배경(prep-redesign-assets.py HOME_ZOOM_P 1.8 · HOME_ZOOM_L 1.3)보다 조금 더
  // 당겨 본다 — 세로는 섬이 화면 높이의 2/3쯤 차게 2.8, 가로 1.5 (오스카 결정)
  const base = fishing
    ? Math.min(L.width / 680, L.height / 1140)
    : L.landscape
      ? (L.height / 1140) * 1.5
      : (((L.height / 874) * 402) / 1536) * 2.8;
  const scale = base * camera.z,
    left = L.width / 2 - camera.x * scale,
    top = L.height / 2 - camera.y * scale;
  const current = useRef({
    camera,
    scale,
    base,
    left,
    top,
    width: L.width,
    height: L.height,
    onSpot,
  });
  current.current = {
    camera,
    scale,
    base,
    left,
    top,
    width: L.width,
    height: L.height,
    onSpot,
  };
  const projectCurrentWorldPoint = useRef(createWorldProjector(() => current.current)).current;
  const origin = useRef({ x: 0, y: 0, z: 1, dist: 0, anchorX: 0, anchorY: 0 }),
    frame = useRef({ x: 0, y: 0 }),
    drag = useRef(false),
    view = useRef<View>(null);
  const clamp = (c: typeof camera) => ({
    ...c,
    x: Math.max(0, Math.min(grid.w, c.x)),
    y: Math.max(0, Math.min(grid.h, c.y)),
    z: Math.max(0.35, Math.min(2.6, c.z)),
  });
  const touches = (e: any) => e.nativeEvent.touches ?? [];
  const dist = (tp: any[]) =>
    tp.length > 1 ? Math.hypot(tp[0].pageX - tp[1].pageX, tp[0].pageY - tp[1].pageY) : 0;
  const midpoint = (tp: any[]) => ({
    x: (tp[0].pageX + tp[1].pageX) / 2 - frame.current.x,
    y: (tp[0].pageY + tp[1].pageY) / 2 - frame.current.y,
  });
  const begin = (tp: any[]) => {
    const v = current.current,
      c = v.camera;
    const m = tp.length > 1 ? midpoint(tp) : { x: v.width / 2, y: v.height / 2 };
    origin.current = {
      ...c,
      dist: dist(tp),
      anchorX: c.x + (m.x - v.width / 2) / v.scale,
      anchorY: c.y + (m.y - v.height / 2) / v.scale,
    };
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, g) =>
        touches(e).length > 1 || Math.abs(g.dx) + Math.abs(g.dy) > 8,
      onPanResponderGrant: (e) => {
        begin(touches(e));
        drag.current = true;
      },
      onPanResponderMove: (e, g) => {
        const tp = touches(e),
          o = origin.current,
          v = current.current;
        if (tp.length > 1) {
          if (!o.dist) {
            begin(tp);
            return;
          }
          const z = Math.max(0.35, Math.min(2.6, (o.z * dist(tp)) / o.dist)),
            m = midpoint(tp);
          setCamera(
            clamp({
              x: o.anchorX - (m.x - v.width / 2) / (v.base * z),
              y: o.anchorY - (m.y - v.height / 2) / (v.base * z),
              z,
            }),
          );
        } else if (!o.dist)
          setCamera(clamp({ x: o.x - g.dx / v.scale, y: o.y - g.dy / v.scale, z: o.z }));
      },
      onPanResponderRelease: () => {
        setTimeout(() => {
          drag.current = false;
        }, 80);
      },
      onPanResponderTerminate: () => {
        drag.current = false;
      },
    }),
  ).current;
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = view.current as any;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setCamera((c) => clamp({ ...c, z: c.z * Math.exp(-e.deltaY * 0.004) }));
    };
    node?.addEventListener?.('wheel', wheel, { passive: false });
    return () => node?.removeEventListener?.('wheel', wheel);
  }, []);
  // 회관·전망대·상점·도서관은 낮·밤 모두 모션 프레임이 그리므로, 테마 착색도 현재 프레임 위에 입힌다.
  const themed = (b: Building) =>
    !!island.buildingThemes?.[b] && island.buildingThemes[b] !== 'default';
  const framesDrawTheme = (b: Building) =>
    b === 'hall' || b === 'tower' || b === 'shop' || b === 'library';
  const night = dayNight === 'night';
  // 건물 하나에 딸린 것(레이어·모션·알림)의 화면 원점 — 서버 배치 평행이동을 카메라 투영 전에 더한다.
  const at = (b: Building) => {
    const o = buildingOffsets?.[b] ?? NO_OFFSET;
    return { left: left + o.x * scale, top: top + o.y * scale };
  };
  return (
    <View
      ref={view}
      onLayout={() =>
        view.current?.measureInWindow?.((x, y) => {
          frame.current = { x, y };
        })
      }
      {...pan.panHandlers}
      testID={fishing ? 'fishing-world' : 'final-island-world'}
      style={{ flex: 1, backgroundColor: '#a9d9d7', overflow: 'hidden' }}
    >
      {fishing ? (
        <Image
          source={require('@/assets/reference-v2/sea-tile.jpg')}
          resizeMode="repeat"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <Pattern
              id="home-ocean"
              width={320 * scale}
              height={88 * scale}
              patternUnits="userSpaceOnUse"
            >
              <SvgImage
                href={
                  village
                    ? villageAssets['terrain.png']
                    : assets[`backgrounds/island/base/${dayNight}.png`]
                }
                x={-800 * scale}
                y={-936 * scale}
                width={1536 * scale}
                height={1024 * scale}
                preserveAspectRatio="none"
              />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#home-ocean)" />
        </Svg>
      )}
      {tileTerrain && (
        <TileTerrainCanvas
          width={L.width}
          height={L.height}
          camera={camera}
          base={base}
          night={dayNight === 'night'}
          assets={mapAssets}
          onAssetsFail={onMapAssetsFail}
          navDebug={navDebug}
        />
      )}
      {tileTerrain && navDebug && (
        <Txt
          pointerEvents="none"
          kind="meta"
          style={{
            position: 'absolute',
            left: semanticTokens.spacing.page,
            top: Math.max(L.insets.top, semanticTokens.spacing.page),
            color: 'white',
            backgroundColor: 'rgba(0,0,0,0.6)',
          }}
        >
          {navDebugText(navDebug.walk, mapAssets.kind)}
        </Txt>
      )}
      <Pressable
        accessible={false}
        style={{
          position: 'absolute',
          left,
          top,
          width: grid.w * scale,
          height: grid.h * scale,
        }}
        onPress={(e) => {
          if (drag.current) return;
          const event = e.nativeEvent as any;
          const rect =
            Platform.OS === 'web' ? (e.currentTarget as any).getBoundingClientRect() : null;
          const tap = {
            locationX: rect ? event.clientX - rect.left : event.locationX,
            locationY: rect ? event.clientY - rect.top : event.locationY,
          };
          if (tileTerrain) {
            // 탭 → 월드. 출발 영역 보정(resolveTarget)은 walk 안의 navPath 가 맡는다.
            const size = { scale, imageWidth: grid.w, imageHeight: grid.h };
            current.current.onSpot?.(worldToImage(tapToWorld(tap, size), size));
            return;
          }
          const p = { x: tap.locationX / scale, y: tap.locationY / scale };
          if (onLand(grid, p)) current.current.onSpot?.(p);
        }}
      >
        {/* 타일 섬 플래그면 지형은 위 Skia 캔버스가 그리고, Pressable 은 탭 영역으로만 남는다. */}
        {!tileTerrain && (
          <Image
            source={
              fishing
                ? require('@/assets/reference-v2/fishing-island.png')
                : village
                  ? villageAssets['terrain.png']
                  : assets[`backgrounds/island/base/${dayNight}.png`]
            }
            style={{ width: '100%', height: '100%' }}
            resizeMode="stretch"
          />
        )}
      </Pressable>
      {!fishing && !village && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {island.buildings
            .filter((b) => !(b === 'mail' && mailboxLetters))
            .filter((b) => !(b === 'hall' && !village && !fishing))
            .filter((b) => !(b === 'board' && !village && !fishing && dayNight === 'day'))
            .filter((b) => !(b === 'tower' && !village && !fishing))
            .filter((b) => !(b === 'shop' && !village && !fishing))
            .filter((b) => !(b === 'library' && !village && !fishing))
            .map((b) => (
              <Image
                key={b}
                testID={`world-static-building-${b}`}
                source={assets[`backgrounds/island/layers/${dayNight}/${layer[b]}.png`]}
                style={{
                  position: 'absolute',
                  ...at(b),
                  width: grid.w * scale,
                  height: grid.h * scale,
                }}
                resizeMode="stretch"
              />
            ))}
          {mailboxLetters && (
            <Image
              testID="mailbox-pelican"
              source={assets['characters/pelican/npc/on-mailbox.png']}
              style={{
                position: 'absolute',
                left: at('mail').left + 250 * scale,
                top: at('mail').top + 456 * scale,
                width: 140 * scale,
                height: 140 * scale,
              }}
              resizeMode="contain"
            />
          )}
          {mailboxLetters && (
            <VillageNotificationBadge
              testID="mailbox-new-indicator"
              accessibilityLabel={t('home.a11y.mailboxNewLetter')}
              scale={scale}
              style={{ left: at('mail').left + 348 * scale, top: at('mail').top + 520 * scale }}
            />
          )}
          {/* 모션 좌표는 placement.json rect 와 같다. 밤 프레임도 같은 rect 로 잘라 정지 밤 레이어와 픽셀이 일치한다. */}
          {island.buildings.includes('hall') && (
            <VillageHallMotion
              testID="world-hall-motion"
              night={night}
              state={hallMotionActive ? 'arrival' : 'normal'}
              generation={hallMotionGeneration}
              themed={themed('hall')}
              style={{
                position: 'absolute',
                left: at('hall').left + 949 * scale,
                top: at('hall').top + 21 * scale,
                width: 242 * scale,
                height: 244 * scale,
              }}
            />
          )}
          {island.buildings.includes('board') && (
            <VillageBoardIndicator
              testID="world-board-indicator"
              showBoardImage={dayNight === 'day'}
              hasUnread={boardStatus === 'unread'}
              hasNewComment={boardStatus === 'new-comment'}
              indicatorScale={scale}
              style={{
                position: 'absolute',
                left: at('board').left + 858 * scale,
                top: at('board').top + 158 * scale,
                width: 80 * scale,
                height: 80 * scale,
              }}
            />
          )}
          {island.buildings.includes('tower') && (
            <VillageObservatoryMotion
              testID="world-observatory-motion"
              themed={framesDrawTheme('tower') && themed('tower')}
              rankState={observatoryRankState}
              dayNight={dayNight}
              night={night}
              generation={towerArrivalActive ? towerArrivalGeneration : 0}
              reduceMotion={state.settings.reduceMotion}
              style={{
                position: 'absolute',
                left: at('tower').left + 150 * scale,
                top: at('tower').top + 24 * scale,
                width: 112 * scale,
                height: 193 * scale,
              }}
            />
          )}
          {island.buildings.includes('shop') && (
            <ShopMotion
              testID="world-shop-motion"
              themed={framesDrawTheme('shop') && themed('shop')}
              state={shopState}
              trigger={shopArrivalActive ? shopArrivalGeneration : 0}
              entryActive={shopArrivalActive}
              night={night}
              reduceMotion={state.settings.reduceMotion}
              style={{
                position: 'absolute',
                left: at('shop').left + 456 * scale,
                top: at('shop').top + 580 * scale,
                width: 262 * scale,
                height: 199 * scale,
              }}
            />
          )}
          {island.buildings.includes('library') && (
            <LibraryMotion
              testID="world-library-motion"
              themed={framesDrawTheme('library') && themed('library')}
              state={libraryState}
              indicatorScale={scale}
              trigger={libraryArrivalActive ? libraryArrivalGeneration : 0}
              entryActive={libraryArrivalActive}
              night={night}
              reduceMotion={state.settings.reduceMotion}
              style={{
                position: 'absolute',
                left: at('library').left + 1120 * scale,
                top: at('library').top + 288 * scale,
                width: 239 * scale,
                height: 323 * scale,
              }}
            />
          )}
          <FireMotion
            testID="world-fire-motion"
            mode={dayNight === 'day' ? 'day' : 'evening'}
            reduceMotion={state.settings.reduceMotion}
            style={{
              position: 'absolute',
              left: left + (dayNight === 'day' ? 402 : 405) * scale,
              top: top + (dayNight === 'day' ? 425 : 437) * scale,
              width: (dayNight === 'day' ? 116 : 140) * scale,
              height: (dayNight === 'day' ? 77 : 93) * scale,
            }}
          />
          <RaftWaterMotion
            testID="world-raft-water-motion"
            reduceMotion={state.settings.reduceMotion}
            style={{
              left: left + 185 * scale,
              top: top + 835 * scale,
              width: 210 * scale,
              height: 92 * scale,
            }}
          />
        </View>
      )}
      {!fishing && island.theme !== 'default' && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left,
            top,
            width: grid.w * scale,
            height: grid.h * scale,
            backgroundColor: '#ade1f8',
            opacity: 0.12,
          }}
        />
      )}
      {!fishing && !village && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {island.buildings
            .filter(
              (b) =>
                (b !== 'mail' || !mailboxLetters) &&
                // 모션 프레임이 착색을 맡는 건물은 닫힌 모습의 정적 테마 레이어를 겹쳐 그리지 않는다.
                !framesDrawTheme(b) &&
                island.buildingThemes?.[b] &&
                island.buildingThemes?.[b] !== 'default',
            )
            .map((b) => (
              <Image
                key={b}
                testID={`world-building-theme-${b}`}
                source={assets[`backgrounds/island/layers/${dayNight}/${layer[b]}.png`]}
                style={{
                  position: 'absolute',
                  ...at(b),
                  width: grid.w * scale,
                  height: grid.h * scale,
                  tintColor: '#d7829b',
                  opacity: 0.3,
                }}
                resizeMode="stretch"
              />
            ))}
        </View>
      )}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left,
          top,
          width: grid.w * scale,
          height: grid.h * scale,
        }}
      >
        {village && (
          <VillageScenery
            scene={village}
            scale={scale}
            reduce={state.settings.reduceMotion}
            mailboxLetters={mailboxLetters}
            hiddenBuilding={hiddenVillageBuilding}
            boardStatus={boardStatus}
            hallMotionActive={hallMotionActive}
            hallMotionGeneration={hallMotionGeneration}
            hallThemed={!!island.buildingThemes?.hall && island.buildingThemes.hall !== 'default'}
          />
        )}
        {typeof children === 'function'
          ? (children as (scale: number, project: (point: Point) => Point) => React.ReactNode)(
              scale,
              projectCurrentWorldPoint,
            )
          : children}
      </View>
    </View>
  );
}
function FinalIslandScene({
  state,
  go,
  build,
  showHud = true,
  showActions = true,
  request,
  notify,
  dispatch,
  viewingIslandId,
  focusTutorial,
  motion,
  showMailboxLetters,
  boardStatus = null,
  observatoryRankState = 'normal',
  shopState = 'normal',
  libraryState = 'normal',
  onBuildingEntrySound,
  layeredPreview = false,
  onServerBuilt,
  mapAssets = BUNDLE_ASSETS,
  onMapAssetsFail,
  navDebug = false,
}: {
  state: State;
  go: (r: Route, id?: string) => void;
  build: (b: Building) => void;
  showHud?: boolean;
  showActions?: boolean;
  request?: Route | null;
  notify?: (s: string) => void;
  dispatch?: (a: { type: string; [key: string]: any }) => void;
  viewingIslandId?: string;
  focusTutorial?: { text: string; onPress: () => void; onSkip: () => void };
  motion?: CatMotionInput;
  showMailboxLetters?: boolean;
  boardStatus?: 'unread' | 'new-comment' | null;
  observatoryRankState?: ObservatoryRankState;
  shopState?: ShopMotionState;
  libraryState?: LibraryMotionState;
  /** 문 소스 확보 전까지는 선택적 연결 계약으로 두고 소리가 꺼져 있으면 호출하지 않는다. */
  onBuildingEntrySound?: (target: BuildingTransitionTarget, generation: number) => void;
  layeredPreview?: boolean;
  /** 서버 모드 홈 스냅샷 재조회 — 넘긴 화면(홈)에서만 서버 짓기 카드를 띄운다. */
  onServerBuilt?: () => void;
  mapAssets?: MapAssetSource;
  onMapAssetsFail?: (file: TilesetFile) => void;
  /** 개발 전용 이동 보기 — 켜진 동안만 마지막 걷기를 기록한다. */
  navDebug?: boolean;
}) {
  // 구경 중이면 구경하는 섬을 그리고, 내 고양이·집중·건설 없이 둘러보기만 한다.
  // viewingIslandId는 방문 카드에서 들어온 읽기 전용 경로라 전역 소속/방문 상태를 바꾸지 않는다.
  const explicitVisit = !!viewingIslandId,
    // 방문 카드(viewingIslandId)로 연 섬은 내 홈 스냅샷으로 대신 그리지 않는다 — 기존 폴백 유지
    i = viewingIslandId
      ? (state.islands.find((island) => island.id === viewingIslandId) ?? viewIsland(state))
      : homeIsland(state),
    // 서버 모드 내 섬 홈이면 스냅샷(GROMO-2138) — 주민 색·오늘 집중을 서버 값으로 그린다
    facts = explicitVisit || state.visitingIslandId ? null : serverHome(state),
    visiting = explicitVisit || !!state.visitingIslandId,
    L = useAppLayout(),
    focusTarget = useSpotlightTarget(!!focusTutorial);
  const focusTutorialLatest = useRef(focusTutorial);
  focusTutorialLatest.current = focusTutorial;
  const mailboxLetters = !visiting && (showMailboxLetters ?? hasMailboxLetters(state, i.id));
  const serverConstruction = state.serverIslands?.clientConstruction;
  const trackedConstruction = facts
    ? serverConstruction?.islandId === facts.islandId
      ? serverConstruction
      : null
    : (i.construction ?? null);
  const progress = normalizedConstructionProgress(
    trackedConstruction
      ? { startedAt: trackedConstruction.startedAt, completesAt: trackedConstruction.endsAt }
      : null,
    Date.now(),
  );
  const activeBuilding =
    trackedConstruction && progress < 1 ? trackedConstruction.building : undefined;
  const sceneBuilding = trackedConstruction?.building;
  const layout = facts?.home?.layout;
  // villageScene 에 넘기는 것과 같은 완공 목록(공사 중인 건물 포함).
  const navBuildings =
    sceneBuilding && !i.buildings.includes(sceneBuilding)
      ? [...i.buildings, sceneBuilding]
      : i.buildings;
  // 서버 모드 homeIsland 는 렌더마다 buildings 배열을 새로 만든다 — 내용 키로 묶지 않으면 scene 이 매번 새로 생겨
  // [positionKey, scene] 효과의 setPos 가 무한 렌더를 돈다(Maximum update depth exceeded).
  const buildingsKey = i.buildings.join(',');
  const scene = useMemo(() => {
    if (!layeredPreview) return undefined;
    const built = villageScene(navBuildings);
    // ponytail: 서버 배치는 그리는 위치만 바꾼다. 통행 셀(grid)·공사 위치는 map.json 기준 그대로 —
    // 서버 배치는 이 브랜치에 들어왔고(2232), 통행·건설 위치를 layout 으로 옮기는 것은 후속에 villageScene 이 objects 를 받아 다시 계산하게 한다.
    // 플래그 off 에서는 서버 배치를 무시해 map.json 그대로 그린다.
    // 타일 섬(기존 마을)은 여기가 아니라 아래 buildingOffsets(건물별 평행이동)로 layout 을 적용한다.
    const objects = TILE_ISLAND ? applyLayout(built.objects, layout, mapAssets) : built.objects;
    return objects === built.objects ? built : { ...built, objects };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navBuildings(렌더마다 새 배열)는 buildingsKey·sceneBuilding 으로 대신 묶는다
  }, [layeredPreview, buildingsKey, sceneBuilding, layout, mapAssets]);
  const grid = scene?.grid ?? grids.home;
  // 타일 섬(기존 마을)은 건물 레이어가 전체 캔버스 이미지라 자르지 않고 서버 배치만큼 통째로 평행이동한다 —
  // 레이어·모션·알림·공사 스프라이트·문(탭 영역·걷기 목표)·이름표가 같은 값을 쓴다. 기본 배치면 전부 0(픽셀 동일).
  // ponytail: 통행 셀은 정적 v1/nav.json 그대로라 옮긴 건물이 막는 칸은 바뀌지 않는다 — 서버가 nav 산출물을 가지면 그걸로 바꾼다.
  const buildingOffsets: BuildingOffsets = useMemo(
    () => (TILE_ISLAND && !scene ? legacyLayoutOffsets(layout) : {}),
    [scene, layout],
  );
  // WorldMap 이 부모와 같은 낮·밤 값을 쓰도록 한 번만 계산해 내려준다.
  const dayNight = useVillageDayNight();
  const hasEntrySprite = (target: BuildingTransitionTarget | null) =>
    // 네 건물은 낮·밤 모두 진입 프레임이 있다.
    !scene &&
    (target === 'hall' || target === 'library' || target === 'shop' || target === 'tower');
  // 렌더 시점 스프레드 — legacyDoors 의 label 게터가 여기서 그때 언어로 복사된다. useMemo/useCallback/React.memo
  // 로 감싸면 언어를 바꿔도 라벨이 굳으니 메모이즈하지 않는다(GROMO-2239·에픽 리뷰).
  const doors: Record<string, Door> = scene
    ? Object.fromEntries(
        Object.entries(legacyDoors).map(([id, door]) => [
          id,
          id === 'raft'
            ? {
                ...door,
                x: villageMap.crossings.dock.arrival[0],
                y: villageMap.crossings.dock.arrival[1],
                // 기본 배경 좌표의 뗏목 탭 영역은 마을 장면 좌표와 맞지 않는다.
                hitbox: undefined,
              }
            : door.building
              ? { ...door, ...villageDoors[door.building] }
              : door,
        ]),
      )
    : Object.fromEntries(
        Object.entries(legacyDoors).map(([id, door]) => {
          const o = door.building && buildingOffsets[door.building];
          if (!o) return [id, door];
          const hitbox = door.hitbox && {
            ...door.hitbox,
            x: door.hitbox.x + o.x,
            y: door.hitbox.y + o.y,
          };
          return [id, { ...door, x: door.x + o.x, y: door.y + o.y, hitbox }];
        }),
      );
  const positionKey = i.id + (layeredPreview ? ':layered' : ':original');
  const initial = () =>
    nearestLand(
      grid,
      homePositions[positionKey] ??
        (layeredPreview ? legacyDoorCoords.layeredSpawn : legacyDoorCoords.spawn),
    );
  const [pos, setPos] = useState(initial),
    [walking, setWalking] = useState(false),
    [left, setLeft] = useState(false),
    [interactiveMotion, setInteractiveMotion] = useState<
      'tilt' | 'stretch' | 'groom' | 'yawn' | null
    >(null),
    [motionGen, setMotionGen] = useState(0);
  const [completionBuilding, setCompletionBuilding] = useState<Building | null>(null);
  const previousActiveBuilding = useRef<Building | null>(null);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedBuildingKey = i.buildings.join(',');

  useEffect(() => {
    const previous = previousActiveBuilding.current;
    previousActiveBuilding.current = activeBuilding ?? null;
    if (activeBuilding) {
      if (completionTimer.current !== null) clearTimeout(completionTimer.current);
      completionTimer.current = null;
      setCompletionBuilding(null);
      return;
    }
    if (
      !previous ||
      (!completedBuildingKey.split(',').includes(previous) && sceneBuilding !== previous)
    )
      return;
    if (completionTimer.current !== null) clearTimeout(completionTimer.current);
    setCompletionBuilding(previous);
    completionTimer.current = setTimeout(
      () => {
        completionTimer.current = null;
        setCompletionBuilding((current) => (current === previous ? null : current));
      },
      state.settings.reduceMotion ? 600 : 1800,
    );
  }, [activeBuilding, completedBuildingKey, sceneBuilding, state.settings.reduceMotion]);

  useEffect(
    () => () => {
      if (completionTimer.current !== null) clearTimeout(completionTimer.current);
    },
    [],
  );

  const timedPhase = constructionPhase(progress, activeBuilding !== undefined);
  const constructionSpritePhase: ConstructionSpritePhase | null = activeBuilding
    ? timedPhase === 'foundation'
      ? 'foundation'
      : timedPhase === 'building'
        ? 'structure'
        : timedPhase === 'finishing'
          ? 'finishing'
          : 'completion'
    : completionBuilding
      ? 'completion'
      : null;
  const constructionBuilding = activeBuilding ?? completionBuilding ?? undefined;
  const constructionBase = constructionBuilding
    ? constructionPlacement(constructionBuilding, layeredPreview)
    : undefined;
  const constructionOffset = constructionBuilding && buildingOffsets[constructionBuilding];
  const constructionObject =
    constructionBase && constructionOffset
      ? {
          ...constructionBase,
          x: constructionBase.x + constructionOffset.x,
          y: constructionBase.y + constructionOffset.y,
        }
      : constructionBase;
  const [buildingTransition, setBuildingTransition] = useState<BuildingTransitionState>({
    phase: 'idle',
    target: null,
    direction: null,
    generation: 0,
  });
  const buildingTransitionController = useRef(createBuildingTransitionController()).current;
  const [transitionOrigin, setTransitionOrigin] = useState({ x: L.width / 2, y: L.height / 2 });
  const buildingEntryPending = useRef(false);
  const tiltTimer = useRef<NodeJS.Timeout | null>(null);
  const tapCountRef = useRef(0);
  const tapResetTimer = useRef<NodeJS.Timeout | null>(null);

  const triggerMotion = (m: 'tilt' | 'stretch' | 'groom' | 'yawn', faceLeft?: boolean) => {
    if (tiltTimer.current) {
      clearTimeout(tiltTimer.current);
      tiltTimer.current = null;
    }
    if (faceLeft !== undefined) setLeft(faceLeft);
    setInteractiveMotion(m);
    setMotionGen((g) => g + 1);
    if (state.settings.reduceMotion) {
      tiltTimer.current = setTimeout(() => {
        setInteractiveMotion(null);
      }, 500);
    }
  };
  const triggerTilt = () => triggerMotion('tilt');
  const transitionTimer = useRef<NodeJS.Timeout | null>(null);

  const navigateWithTilt = (targetRoute: Route) => {
    triggerTilt();
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    const delay = state.settings.reduceMotion ? 0 : interactiveMotionDurationMs('tilt');
    if (delay) {
      transitionTimer.current = setTimeout(() => {
        go(targetRoute);
      }, delay);
    } else {
      go(targetRoute);
    }
  };

  const scaleRef = useRef(1);
  useEffect(
    () =>
      buildingTransitionController.subscribe((next) => {
        setBuildingTransition(next);
        if (next.phase === 'idle') buildingEntryPending.current = false;
      }),
    [buildingTransitionController],
  );
  useEffect(() => () => buildingTransitionController.dispose(), [buildingTransitionController]);
  useEffect(() => {
    const target = buildingTransition.target;
    if (
      !state.settings.sound ||
      buildingTransition.phase !== 'entering' ||
      (target !== 'hall' && target !== 'library')
    )
      return;
    onBuildingEntrySound?.(target, buildingTransition.generation);
  }, [
    buildingTransition.generation,
    buildingTransition.phase,
    buildingTransition.target,
    onBuildingEntrySound,
    state.settings.sound,
  ]);

  const handleCatPress = (e: any) => {
    if (walking) return;
    const catSize = 70 * scaleRef.current;
    const hitSize = Math.max(semanticTokens.size.tapMin, catSize);
    const nativeX = e?.nativeEvent?.locationX ?? hitSize / 2;
    const isTouchLeft = nativeX < hitSize / 2;
    setLeft(isTouchLeft);

    if (tapResetTimer.current) clearTimeout(tapResetTimer.current);
    const count = tapCountRef.current % 4;
    tapCountRef.current++;
    tapResetTimer.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 4000);

    const motionCycle: ('tilt' | 'stretch' | 'groom' | 'yawn')[] = isTouchLeft
      ? ['tilt', 'groom', 'stretch', 'yawn']
      : ['stretch', 'tilt', 'yawn', 'groom'];

    triggerMotion(motionCycle[count]);
  };

  useEffect(() => {
    return () => {
      if (tiltTimer.current) clearTimeout(tiltTimer.current);
      if (tapResetTimer.current) clearTimeout(tapResetTimer.current);
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    };
  }, []);
  const xy = useRef(new Animated.ValueXY(pos)).current,
    token = useRef(0),
    location = useRef(pos);
  // 타일 섬 = 플래그 + 기존 마을(새 마을 미리보기가 아님). 홈 섬 장면이라 낚시는 여기 오지 않는다.
  const tileNav = isTileIsland(scene);
  const [navWalk, setNavWalk] = useState<NavWalk | null>(null);
  // 이동 동기화(GROMO-2248) — 플래그·타일 섬·서버 홈일 때만 켠다. 꺼져 있으면 movement 가 null 이라 걷기는 이전과 같다.
  // 배경으로 깔린 홈(showActions=false — 집중 준비·잠금 안내·우체통 안내 뒤)은 조작이 없으니 열지 않는다(구독 = 방 입장).
  const syncIslandId = MOVEMENT_SYNC && tileNav && facts && showActions ? facts.islandId : null;
  // 채널 effect 의존성에 넣어 로그인 세션이 바뀌면(계정 전환 등) 묵은 me 로 연 채널을 그대로 쓰지 않는다.
  const me = getSession()?.userId;
  const movement = useRef<MovementController | null>(null),
    // 걷기 사슬이 도는 중인지 · 그 걷기의 done(서버 경로로 갈아타도 넘겨 준다) · 로컬 경로 셀(월드) · 걷는 중 받은 도착
    stepping = useRef(false),
    walkDone = useRef<(() => void) | undefined>(undefined),
    walkCells = useRef<WorldPoint[]>([]),
    arrival = useRef<Point | null>(null);
  const [remoteActors, setRemoteActors] = useState<MovementActor[] | null>(null);
  const remoteListeners = useRef(new Map<string, RemoteListener>()).current;
  const subscribeRemote = useCallback(
    (userId: string, listener: RemoteListener) => {
      remoteListeners.set(userId, listener);
      return () => {
        if (remoteListeners.get(userId) === listener) remoteListeners.delete(userId);
      };
    },
    [remoteListeners],
  );
  const moving = (value: boolean) => {
    stepping.current = value;
    setWalking(value);
  };
  // 멈춘 상태에서 서버 위치로 맞춘다(FullState 채택·보정·도착).
  const place = (p: Point) => {
    xy.setValue(p);
    location.current = p;
    setPos(p);
    homePositions[positionKey] = p;
  };
  // 주어진 이미지 px 경로(출발점 포함)를 걷는다. 반환값·done 계약은 walk 그대로다(buildingTransition 이 의존).
  // msPerUnit 은 서버 경로를 걸을 때 서버 속도(1000/speed), 없으면 로컬 MS_PER_UNIT.
  const walkPath = (path: Point[], done?: () => void, msPerUnit?: number) => {
    const run = ++token.current;
    xy.stopAnimation();
    arrival.current = null;
    // false 를 돌려준 걷기의 done 은 호출부가 이미 포기했다 — 서버 경로로 갈아탈 때 되살리지 않는다.
    walkDone.current = path.length ? done : undefined;
    if (!path.length) {
      moving(false);
      return false;
    }
    if (path.length > 1) {
      setLeft(path[path.length - 1].x < location.current.x);
    }
    moving(true);
    let idx = 1;
    const next = () => {
      if (run !== token.current) return;
      if (idx >= path.length) {
        moving(false);
        // 걷는 중에 서버 Arrived 가 왔으면 마지막 세그먼트를 마친 뒤 그 자리에 선다.
        if (arrival.current) place(arrival.current);
        arrival.current = null;
        if (pathDistance(path) >= 180) {
          triggerMotion('stretch');
        }
        walkDone.current = undefined;
        done?.();
        movement.current?.settle();
        return;
      }
      const p = path[idx++];
      if (Math.abs(p.x - location.current.x) > 0.5) {
        setLeft(p.x < location.current.x);
      }
      const prev = location.current;
      Animated.timing(xy, {
        toValue: p,
        duration: state.settings.reduceMotion
          ? 0
          : tileNav
            ? stepDurationMs(
                imageToWorld(prev, sizeOf(grid)),
                imageToWorld(p, sizeOf(grid)),
                msPerUnit,
              )
            : 95,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          location.current = p;
          // 월드 단위 정본(location)은 Movement 연결(2단계) 때 저장 형식까지 옮긴다. 그때까지 homePositions 는 px.
          setPos(p);
          homePositions[positionKey] = p;
          next();
        }
      });
    };
    next();
    return true;
  };
  const walk = (target: Point, done?: () => void) => {
    if (tiltTimer.current) clearTimeout(tiltTimer.current);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    setInteractiveMotion(null);
    const path = tileNav
      ? tilePath(activeNav(mapAssets, navBuildings), location.current, target, sizeOf(grid))
      : scene
        ? villagePath(scene, location.current, target)
        : landPath(grid, location.current, nearestLand(grid, target));
    if (tileNav && navDebug) setNavWalk({ tap: target, path });
    // 로컬 A* 로 곧장 걷고 같은 목적지를 서버에 보낸다(바닥·문·뗏목이 전부 여기로 온다).
    // path 가 비었으면(도달 불가) 로컬도 걷지 않는다 — intend 를 보내면 서버가 최근접 경로를 내려 걷게 돼
    // walkPath 의 "무시"와 동작이 갈린다.
    if (movement.current && path.length) {
      walkCells.current = path.slice(1).map((p) => imageToWorld(p, sizeOf(grid)));
      movement.current.intend(imageToWorld(target, sizeOf(grid)));
    }
    return walkPath(path, done);
  };
  // 이동 채널 콜백 — 렌더마다 최신 클로저로 갈아 끼운다(채널은 섬이 바뀔 때만 다시 연다).
  const sync = useRef<Required<MovementCallbacks> & { position: () => WorldPoint }>(null!);
  sync.current = {
    position: () => imageToWorld(location.current, sizeOf(grid)),
    onMyPath: (waypoints, speed, _pathId, start) => {
      const msPerUnit = 1000 / speed;
      // 셀 열이 같고 속도도 로컬과 같으면 지금 걷기를 그대로 둔다. 속도만 다르면(서버 속도 채택 계약) 같은
      // 갈아타기 경로 계산을 재사용해 남은 구간만 그 속도로 다시 걷는다.
      if (sameCells(walkCells.current, waypoints) && Math.abs(msPerUnit - MS_PER_UNIT) <= 1e-6)
        return;
      const size = sizeOf(grid);
      let here = location.current;
      xy.stopAnimation((value) => (here = value));
      location.current = here;
      walkCells.current = waypoints;
      const hereWorld = imageToWorld(here, size);
      const rest = remainingPath([start, ...waypoints], hereWorld);
      // 연결 구간(지금 자리 → 갈아탄 경로의 첫 꼭짓점)도 통행 가능한 경로여야 한다 — 직선은
      // 장애물의 다른 쪽을 지날 수 있어(로컬 예측과 서버 경로가 반대편일 때) 로컬 A* 로 잇는다.
      const target = rest[0] ?? waypoints[waypoints.length - 1] ?? start;
      const connect = navPath(activeNav(mapAssets, navBuildings), hereWorld, target);
      const worldPath = connect.length ? [...connect, ...rest.slice(1)] : rest;
      walkPath([here, ...worldPath.map((p) => worldToImage(p, size))], walkDone.current, msPerUnit);
    },
    onMyArrived: (p) => {
      const at = worldToImage(p, sizeOf(grid));
      if (stepping.current) arrival.current = at;
      else {
        place(at);
        moving(false);
      }
    },
    onMyCorrection: (p) => place(worldToImage(p, sizeOf(grid))),
    onActors: setRemoteActors,
    onRemotePosition: (userId, p, durationMs) =>
      remoteListeners.get(userId)?.(worldToImage(p, sizeOf(grid)), p.moving, durationMs),
  };
  useEffect(() => {
    if (!syncIslandId || !me) return;
    let channel: IslandChannel | null = null;
    const controller = createMovementController({
      me,
      send: (intent) => !!channel && publishMoveIntent(channel, syncIslandId, intent),
      position: () => sync.current.position(),
      walking: () => stepping.current,
      onMyPath: (...args) => sync.current.onMyPath(...args),
      onMyArrived: (p) => sync.current.onMyArrived(p),
      onMyCorrection: (p) => sync.current.onMyCorrection(p),
      onActors: (actors) => sync.current.onActors(actors),
      onRemotePosition: (userId, p, durationMs) =>
        sync.current.onRemotePosition(userId, p, durationMs),
    });
    movement.current = controller;
    channel = stompIslandChannel({
      islandId: syncIslandId,
      presence: false,
      emote: false,
      movement: true,
      onEvent: controller.onMessage,
      onOpen: () => {},
      // 이동 채널 영구 거절(STOMP ERROR·NOT_A_MEMBER)일 때만 이 화면 동안 동기화를 끄고 로컬 걷기·Wanderer 로
      // 돌아간다 — 토스트는 없다. 그 외 오류 큐 코드(예: 속도 제한)는 onError 로만 오고 동기화는 그대로 둔다.
      onMovementDenied: () => {
        controller.deny();
        movement.current = null;
        setRemoteActors(null);
        channel?.close();
      },
      onError: () => {},
    });
    return () => {
      // close() 의 deactivate() 는 비동기라 닫히는 중 도착한 메시지가 옛 controller.onMessage 로 들어가
      // sync.current(이미 새 섬 클로저로 바뀌어 있을 수 있다) 를 건드릴 수 있다 — deny 를 먼저 불러 막는다.
      controller.deny();
      movement.current = null;
      channel?.close();
      setRemoteActors(null);
    };
  }, [syncIslandId, me]);
  useEffect(() => {
    const p = initial();
    location.current = p;
    xy.setValue(p);
    setPos(p);
    setWalking(false);
    stepping.current = false;
    return () => {
      token.current++;
      xy.stopAnimation();
      walkDone.current = undefined;
    };
  }, [positionKey, scene]);
  useEffect(() => {
    if (request && !visiting) {
      const d = Object.values(doors).find((d) => d.r === request);
      if (d) {
        if (d.direct) {
          navigateWithTilt(request);
        } else {
          walk(d, () => {
            navigateWithTilt(request);
          });
        }
      }
    }
  }, [request]);

  const wanderColors = useMemo(() => {
    const myId = getSession()?.userId;
    // 서버 주민 색은 고른 사람만 — catColor null 은 임의 색으로 채우지 않는다
    const others = facts
      ? facts.members.filter((m) => m.id !== myId && m.catColor).map((m) => catColor(m.catColor))
      : i.members.filter((m) => m.id !== 'me').map((m) => m.color as Color);
    // 모자란 자리를 보충 색으로 채우는 연출은 목업 섬에서만 — 서버 홈엔 없는 주민을 세우지 않는다
    const spare = facts
      ? []
      : (['white', 'gray', 'ginger', 'calico', 'cream', 'black'] as Color[]).filter(
          (c) => c !== state.color && !others.includes(c),
        );
    return [...others, ...spare].slice(0, 2);
  }, [i.members, facts, state.color]);
  // Child positions scale with the camera, rather than being pasted onto a cropped image.
  const actors = (s: number, project: (point: Point) => Point) => {
    scaleRef.current = s;
    const catSize = 70 * s;
    const hitSize = Math.max(semanticTokens.size.tapMin, catSize);
    return (
      <>
        {constructionObject && constructionBuilding && constructionSpritePhase && (
          <View
            pointerEvents="none"
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${buildingNames[constructionBuilding]} ${constructionPhaseLabels[constructionSpritePhase]}`}
            accessibilityLiveRegion="polite"
            testID={`village-construction-${constructionBuilding}`}
            style={{
              position: 'absolute',
              left: (constructionObject.x - constructionObject.w / 2) * s,
              top: (constructionObject.y - constructionObject.h) * s,
              width: constructionObject.w * s,
              height: constructionObject.h * s,
              zIndex: Math.round(constructionObject.y),
            }}
          >
            <ConstructionBuildingSprite
              building={constructionBuilding}
              phase={constructionSpritePhase}
              reduceMotion={state.settings.reduceMotion}
              testID={`village-construction-sprite-${constructionBuilding}`}
            />
          </View>
        )}
        {Object.entries(doors)
          // 방문 카드에서 연 읽기 전용 화면은 낚시섬 관전만 연다. 기존 방문자 홈은 회관·게시판도 열 수 있다.
          .filter(([, d]) =>
            explicitVisit
              ? !!d.visitorRoute
              : d.building && !i.buildings.includes(d.building)
                ? false
                : d.memberOnly
                  ? !visiting || !!d.visitorRoute
                  : !!d.building,
          )
          .map(([id, d]) => {
            const hitbox = d.hitbox ?? { x: d.x - 60, y: d.y - 95, w: 120, h: 125 };
            const labelOnRight = d.building != null && rightAlignedBuildingLabels.has(d.building);
            const buildingLabelPosition = (() => {
              if (id === 'raft') {
                return scene
                  ? {
                      left: (185 - hitbox.x) * s,
                      top: (805 - hitbox.y) * s,
                      width: 210 * s,
                      alignItems: 'center' as const,
                    }
                  : {
                      left: 0,
                      top: -30,
                      width: hitbox.w * s,
                      alignItems: 'center' as const,
                    };
              }
              if (d.building == null) return { left: 0, top: 0, alignItems: 'flex-start' as const };
              if (scene) {
                return labelOnRight
                  ? { right: 0, top: -30, alignItems: 'flex-end' as const }
                  : { left: 0, top: -30, alignItems: 'flex-start' as const };
              }
              // 이름표 컨테이너(hitbox)는 이미 shift 만큼 옮겨져 있다. box·anchorY 상수에도 같은 shift 를 더해야
              // 컨테이너 기준 상대 위치가 그대로다(더하지 않으면 -shift 만큼 틀어진다).
              const shift = buildingOffsets[d.building] ?? NO_OFFSET;
              const box = legacyBuildingLabelBox[d.building];
              const anchorY = legacyBuildingLabelAnchorY[d.building] + shift.y;
              const anchorXOffset = legacyBuildingLabelAnchorXOffset[d.building] ?? 0;
              return labelOnRight
                ? {
                    right: (hitbox.x + hitbox.w - (box.x + shift.x + box.w)) * s,
                    top: (anchorY - hitbox.y) * s,
                    alignItems: 'flex-end' as const,
                  }
                : {
                    left: (box.x + shift.x + anchorXOffset - hitbox.x) * s,
                    top: (anchorY - hitbox.y) * s,
                    alignItems: 'flex-start' as const,
                  };
            })();
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={
                  id === 'mail' && mailboxLetters
                    ? t('home.door.mailNewLetter')
                    : d.building === 'board' && boardStatus === 'new-comment'
                      ? t('home.door.newComment', { label: d.label })
                      : d.building === 'board' && boardStatus === 'unread'
                        ? t('home.door.unreadNotice', { label: d.label })
                        : d.building === 'shop' && shopState === 'new-product'
                          ? t('home.door.newProduct', { label: d.label })
                          : d.building === 'shop' && shopState === 'purchasable'
                            ? t('home.door.purchasable', { label: d.label })
                            : d.building === 'tower' && observatoryRankState === 'rank-updated'
                              ? t('home.door.rankUpdated', { label: d.label })
                              : d.building === 'tower' && observatoryRankState === 'rank-changed'
                                ? t('home.door.rankChanged', { label: d.label })
                                : d.building === 'library' && libraryState === 'new-quest'
                                  ? t('home.door.newQuest', { label: d.label })
                                  : d.building === 'library' && libraryState === 'new-reading'
                                    ? t('home.door.newReading', { label: d.label })
                                    : d.label
                }
                // 토스트는 iOS 스크린리더가 읽지 않으므로 구경 중 주민 전용 건물은 미리 알려 준다
                accessibilityHint={
                  d.building === 'hall' && !visiting
                    ? t('home.door.hallHint')
                    : d.building === 'board' && !!boardStatus
                      ? t('home.door.boardHint')
                      : d.building === 'shop' && shopState !== 'normal'
                        ? t('home.door.shopHint')
                        : d.building === 'tower' && observatoryRankState !== 'normal'
                          ? t('home.door.towerHint')
                          : d.building === 'library' && libraryState !== 'normal'
                            ? t('home.door.libraryHint')
                            : visiting && d.building && !['hall', 'board'].includes(d.building)
                              ? t('home.door.membersOnly')
                              : undefined
                }
                onPress={() => {
                  if (!visiting) {
                    if (buildingEntryPending.current) return;
                    if (d.direct) {
                      return navigateWithTilt(d.r);
                    }
                    const transitionTarget =
                      d.building && d.building in BUILDING_TRANSITION_ROUTE
                        ? (d.building as BuildingTransitionTarget)
                        : null;
                    const enter = () => {
                      if (!transitionTarget) {
                        navigateWithTilt(d.r);
                        return true;
                      }
                      setTransitionOrigin(project(d));
                      return buildingTransitionController.start(
                        transitionTarget,
                        'enter',
                        state.settings.reduceMotion,
                        () => go(BUILDING_TRANSITION_ROUTE[transitionTarget]),
                        hasEntrySprite(transitionTarget)
                          ? BUILDING_ENTRY_DURATION_MS
                          : BUILDING_TRANSITION_DURATION_MS,
                      );
                    };
                    if (transitionTarget) {
                      buildingEntryPending.current = true;
                      return runBuildingEntryWalk(
                        (onArrival) => walk(d, onArrival),
                        enter,
                        () => {
                          buildingEntryPending.current = false;
                        },
                      );
                    }
                    return walk(d, enter);
                  }
                  if (d.visitorRoute) return go(d.visitorRoute, i.id);
                  // 구경 중: 고양이가 걷지 않고 바로 연다. 회관은 책상 없이 섬 정보 카드로, 게시판만 열람
                  if (d.building === 'hall') go('manage');
                  else if (d.building === 'board') go('board');
                  else notify?.(t('home.door.membersOnly'));
                }}
                style={{
                  position: 'absolute',
                  left: hitbox.x * s,
                  top: hitbox.y * s,
                  width: hitbox.w * s,
                  height: hitbox.h * s,
                  minWidth: 44,
                  minHeight: 44,
                  zIndex: scene ? 2000 : undefined,
                }}
              >
                {(d.building || id === 'raft') && (
                  <View
                    testID={`building-name-${id}`}
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      ...buildingLabelPosition,
                    }}
                  >
                    <View
                      style={{
                        minHeight: componentTokens.villageBuildingNameTag.minHeight,
                        justifyContent: 'center',
                        paddingHorizontal: componentTokens.villageBuildingNameTag.paddingHorizontal,
                        borderRadius: componentTokens.villageBuildingNameTag.radius,
                        borderWidth: componentTokens.villageBuildingNameTag.borderWidth,
                        borderColor: semanticTokens.color.outline,
                        backgroundColor:
                          (d.building === 'shop' && shopState !== 'normal') ||
                          (d.building === 'tower' && observatoryRankState !== 'normal')
                            ? semanticTokens.color.accent
                            : semanticTokens.color.surface,
                      }}
                    >
                      <Txt kind="meta" numberOfLines={1} style={{ fontWeight: '700' }}>
                        {d.label}
                      </Txt>
                    </View>
                  </View>
                )}
              </Pressable>
            );
          })}
        {/* 주민 고양이 두 마리: 주민 색을 우선 쓰고, 모자라면 내 색과 다른 색으로 채운다 */}
        {!remoteActors &&
          wanderColors.map((color, n) => (
            <Wanderer
              key={color + n}
              color={color}
              start={nearestLand(grid, WANDER_STARTS[n])}
              scene={scene}
              assets={mapAssets}
              buildings={navBuildings}
              s={s}
              reduce={state.settings.reduceMotion}
              delay={1200 + n * 2500}
            />
          ))}
        {/* 이동 동기화 중이면 Wanderer 대신 서버가 정한 주민 — 색을 고른 주민만(catColor null·명단 밖은 그리지 않는다) */}
        {remoteActors?.map((a) => {
          const color = facts?.members.find((m) => m.id === a.userId)?.catColor;
          return color ? (
            <RemoteResident
              key={a.userId}
              userId={a.userId}
              color={catColor(color)}
              start={worldToImage(a, sizeOf(grid))}
              s={s}
              reduce={state.settings.reduceMotion}
              subscribe={subscribeRemote}
            />
          ) : null;
        })}
        {/* 구경 중에는 내 고양이가 이 섬에 없다 */}
        {!visiting && (
          <Animated.View
            testID="home-cat-container"
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: Animated.subtract(Animated.multiply(xy.x, s), hitSize / 2),
              top: Animated.subtract(Animated.multiply(xy.y, s), catSize / 2 + hitSize / 2),
              width: hitSize,
              height: hitSize,
              zIndex: scene ? Math.round(pos.y) : 25,
            }}
          >
            {/* v2 홈 시안은 고양이 100px(섬 원본 좌표)인데 카메라를 당기면서 70px 로 줄임 · 이름표 없음 */}
            <Pressable
              testID="home-cat-actor"
              accessibilityRole="button"
              accessibilityLabel={t('character.title')}
              onPress={handleCatPress}
              style={{
                width: hitSize,
                height: hitSize,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  left: hitSize / 2,
                  top: catSize / 2 + hitSize / 2,
                }}
              >
                <CatSprite
                  testID="home-cat-sprite"
                  color={state.color}
                  size={catSize}
                  motion={motion ?? (walking ? 'walking' : (interactiveMotion ?? 'idle'))}
                  left={left}
                  reduce={state.settings.reduceMotion}
                  onFinish={interactiveMotion ? () => setInteractiveMotion(null) : undefined}
                  generation={motionGen}
                />
              </View>
            </Pressable>
          </Animated.View>
        )}
      </>
    );
  };
  const next = !i.buildings.includes('hall')
    ? 'hall'
    : !i.buildings.includes('board')
      ? 'board'
      : null;
  const buildCardStyle = {
    position: 'absolute',
    left: L.landscape ? Math.max(56, L.insets.left + 4) : 20,
    width: L.landscape ? 300 : L.width * 0.52,
    bottom: L.landscape ? 24 : Math.max(52, L.insets.bottom + 18),
    // 지도 위에 겹치는 반투명 카드 — Paper 표면에 알파만 더해 지도가 살짝 비치게 한다
    backgroundColor: `${semanticTokens.color.surface}F2`,
    borderColor: semanticTokens.color.outline,
    borderWidth: semanticTokens.stroke.default,
    borderRadius: componentTokens.card.radius,
    paddingVertical: semanticTokens.spacing.control,
    paddingHorizontal: semanticTokens.spacing.control,
    gap: primitiveTokens.space[2],
  } as const;
  const today = facts ? facts.home.focusSummary.totalSeconds : todayFocusSeconds(state, i.id),
    todayClock = [Math.floor(today / 3600), Math.floor(today / 60) % 60, Math.floor(today) % 60]
      .map((v) => String(v).padStart(2, '0'))
      .join(':');
  // 안드로이드 홈 위젯('오늘의 공부시간')에 HUD와 같은 오늘 집중값을 넘긴다. 구경 중인 섬은 내 기록이 아니라 제외.
  useEffect(() => {
    if (visiting) return;
    void updateStudyWidget(buildStudyWidgetSnapshot(state.records, i.id, today));
  }, [visiting, state.records, i.id, today]);
  const hudTop = L.landscape ? 14 : Math.max(64, L.insets.top + 5),
    hudLeft = L.landscape ? Math.max(56, L.insets.left + 4) : 20,
    // 오른쪽 여백은 오른쪽 안전영역으로 따로 잡는다(노치가 오른쪽인 가로 방향) — 아래 집중 버튼과 같은 규칙
    hudRight = L.landscape ? Math.max(56, L.insets.right + 4) : 20,
    hudMax = Math.max(0, L.width - hudLeft - hudRight),
    rewardCount = claimableQuestRewardCount(state.rewards, i.id),
    showQuestIndicator =
      showHud &&
      showActions &&
      !visiting &&
      i.buildings.includes('board') &&
      (i.quests.length > 0 || rewardCount > 0);
  const departFocus = () => {
    if (buildingEntryPending.current) return;
    // 걷기가 끝나 항해가 실제로 시작된 뒤에 진행한다 — 도중에 끊기면 4단계 스포트라이트가 남는다.
    const started = !!focusTutorial;
    walk(doors.raft, () => {
      // 걷는 도중 안내 그만 보기로 4단계가 사라졌으면 저장된 단계를 되돌리지 않고 항해도 시작하지 않는다.
      if (started && !focusTutorialLatest.current) return;
      focusTutorialLatest.current?.onPress();
      go('focusTravel');
    });
  };
  return (
    <TutorialScene
      style={{ flex: 1 }}
      onSkip={focusTutorial?.onSkip}
      overlay={
        focusTutorial && (
          <TutorialSpotlight
            target={focusTarget.rect}
            text={focusTutorial.text}
            action={{ title: t('focus.start'), onPress: departFocus }}
          />
        )
      }
    >
      <WorldMap
        state={state}
        village={scene}
        buildingOffsets={buildingOffsets}
        mapAssets={mapAssets}
        onMapAssetsFail={onMapAssetsFail}
        navDebug={
          tileNav && navDebug ? { nav: activeNav(mapAssets, navBuildings), walk: navWalk } : null
        }
        islandId={i.id}
        hallMotionActive={
          buildingTransition.phase === 'entering' && buildingTransition.target === 'hall'
        }
        hallMotionGeneration={buildingTransition.generation}
        boardStatus={visiting ? null : boardStatus}
        observatoryRankState={observatoryRankState}
        shopState={shopState}
        libraryState={visiting ? 'normal' : libraryState}
        libraryArrivalActive={
          buildingTransition.phase === 'entering' && buildingTransition.target === 'library'
        }
        libraryArrivalGeneration={buildingTransition.generation}
        towerArrivalActive={
          buildingTransition.phase === 'entering' && buildingTransition.target === 'tower'
        }
        towerArrivalGeneration={buildingTransition.generation}
        shopArrivalActive={
          buildingTransition.phase === 'entering' && buildingTransition.target === 'shop'
        }
        shopArrivalGeneration={buildingTransition.generation}
        showMailboxLetters={mailboxLetters}
        hiddenVillageBuilding={activeBuilding}
        dayNight={dayNight}
        onSpot={
          visiting
            ? undefined
            : (p) => {
                if (!buildingEntryPending.current) walk(p);
              }
        }
        children={actors as any}
      />
      {showHud && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: hudTop,
            left: hudLeft,
            zIndex: 10,
            alignItems: 'flex-start',
          }}
        >
          <View
            pointerEvents="none"
            // 섬 이름·오늘 집중·시간을 스크린리더가 한 번에 읽는다
            accessible={!visiting}
            accessibilityLabel={
              visiting
                ? undefined
                : t('home.a11y.todayFocusClock', { name: i.name, clock: todayClock })
            }
            style={{
              backgroundColor: '#FFFDFAB3',
              borderRadius: 999,
              paddingVertical: 6,
              paddingLeft: 14,
              paddingRight: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              // 섬 이름(최대 20자)이 길어도 화면 밖으로 밀리지 않게 폭을 묶어 이름만 말줄임한다.
              // 아주 좁은 창에서 minWidth 가 maxWidth 를 이기지 않게 같은 상한으로 묶는다
              minWidth: visiting ? undefined : Math.min(210, hudMax),
              maxWidth: visiting ? undefined : hudMax,
            }}
          >
            {/* 구경 중에는 내 집중 시간 대신 어느 섬을 구경하는지만 작게 보여준다 */}
            {visiting ? (
              <Txt kind="meta" style={{ fontSize: 13, lineHeight: 18.85, fontWeight: '600' }}>
                {t('home.hud.visiting', { name: i.name })}
              </Txt>
            ) : (
              <>
                {/* 어느 섬의 홈인지 — 서버 모드는 스냅샷의 섬 이름(GROMO-2138) */}
                <View style={{ flexShrink: 1 }}>
                  <Txt
                    kind="meta"
                    numberOfLines={1}
                    style={{ fontSize: 12, lineHeight: 17.4, fontWeight: '700' }}
                  >
                    {i.name}
                  </Txt>
                  <Txt kind="meta" style={{ fontSize: 12, lineHeight: 17.4, fontWeight: '600' }}>
                    {t('home.hud.todayFocus')}
                  </Txt>
                </View>
                <Txt
                  style={{
                    fontSize: 22,
                    lineHeight: 31.9,
                    fontWeight: '700',
                    fontVariant: ['tabular-nums'],
                    marginLeft: 'auto',
                  }}
                >
                  {todayClock}
                </Txt>
              </>
            )}
          </View>
          {showQuestIndicator && (
            <HomeQuestIndicator
              quests={i.quests}
              rewardCount={rewardCount}
              onPress={() => go('quest', HOME_QUEST_LIST_DETAIL)}
              style={{ marginTop: componentTokens.homeQuestIndicator.hudGap }}
            />
          )}
        </View>
      )}
      {showActions && (
        <>
          {/* 서버 모드 첫 건물(회관·게시판)은 방장만 홈에서 서버 건설로 짓는다(GROMO-2139) */}
          {!visiting && facts && next && facts.home.island.role === 'host' && onServerBuilt && (
            <ServerBuildCard
              key={`${facts.islandId}:${next}`}
              islandId={facts.islandId}
              building={next}
              villagePoints={facts.home.wallets.villagePoints}
              tracked={trackedConstruction}
              style={buildCardStyle}
              onStarted={(receipt) =>
                dispatch?.({
                  type: 'SERVER_CONSTRUCTION_STARTED',
                  ...receipt,
                })
              }
              onChanged={onServerBuilt}
            />
          )}
          {/* 로컬 비용·BUILD 카드는 목업에서만 띄운다 */}
          {!visiting && !facts && (i.construction || next) && (
            <View style={buildCardStyle}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Txt style={{ fontSize: 14, lineHeight: 20.3, fontWeight: '800' }}>
                  {i.construction
                    ? t('home.buildInProgress', {
                        building: buildingNames[i.construction.building],
                      })
                    : t('home.build', { building: buildingNames[next!] })}
                </Txt>
                <Txt
                  kind="meta"
                  style={{
                    fontSize: 12,
                    lineHeight: 17.4,
                    fontWeight: '600',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {i.construction
                    ? t('home.buildMinutesLeft', {
                        count: Math.max(0, Math.ceil((i.construction.endsAt - Date.now()) / 60000)),
                      })
                    : t('home.buildProgress', {
                        current: balance(i),
                        total: buildingCost(i, next!),
                      })}
                </Txt>
              </View>
              <View
                style={{
                  height: 6,
                  backgroundColor: '#EADFD2',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    height: '100%',
                    width: `${i.construction ? Math.max(0, Math.min(100, (100 * (Date.now() - i.construction.startedAt)) / (i.construction.endsAt - i.construction.startedAt))) : Math.min(100, (balance(i) / buildingCost(i, next!)) * 100)}%`,
                    backgroundColor: '#FFA6BC',
                  }}
                />
              </View>
              {!i.construction && next && balance(i) >= buildingCost(i, next) && isHost(i) && (
                <Btn
                  small
                  title={t('home.buildAction')}
                  style={{ marginTop: 2 }}
                  onPress={() => build(next)}
                />
              )}
            </View>
          )}
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              ...(visiting
                ? { left: 0, right: 0, alignItems: 'center' }
                : { right: L.landscape ? Math.max(56, L.insets.right + 4) : 20 }),
              bottom: L.landscape
                ? Math.max(22, L.insets.bottom)
                : Math.max(44, L.insets.bottom + 10),
            }}
          >
            {visiting ? (
              <Btn
                kind="butter"
                title={t('home.returnToMyIsland')}
                id="visit-return"
                onPress={() => {
                  // 구경을 끝내고 내 섬으로 배를 타고 돌아간다. Travel 도착 시 SWITCH_ISLAND 후 홈
                  dispatch?.({ type: 'TRAVEL_FROM', name: i.name });
                  dispatch?.({ type: 'END_VISIT' });
                  go('travel', currentIsland(state).id);
                }}
              />
            ) : (
              <View ref={focusTarget.ref} collapsable={false} onLayout={focusTarget.measure}>
                <Btn round title={t('focus.start')} id="depart-focus" onPress={departFocus} />
              </View>
            )}
          </View>
        </>
      )}
      <BuildingTransitionOverlay
        state={buildingTransition}
        reduceMotion={state.settings.reduceMotion}
        origin={transitionOrigin}
        delayMs={
          buildingTransition.direction === 'enter' && hasEntrySprite(buildingTransition.target)
            ? BUILDING_SPRITE_LEAD_IN_MS
            : 0
        }
      />
    </TutorialScene>
  );
}

// 개발 빌드 또는 명시적인 QA 빌드에서만 제공하는 로컬 표시 전환이다.
const CAN_PREVIEW_VILLAGE = __DEV__ || process.env.EXPO_PUBLIC_VILLAGE_PREVIEW === '1';
const sizeOf = (g: { w: number; h: number }) => ({ imageWidth: g.w, imageHeight: g.h });
// 화면 스냅샷(GROMO-2233)의 nav.json 을 완공 목록별로(미완공 건물 자리는 통행). 같은 소스면 같은 JSON 객체라 loadNav 의 캐시가 맞는다.
const activeNav = (assets: MapAssetSource, completed: readonly string[]) =>
  loadNav(readMapJson('nav.json', bundledNavJson, assets) as any, completed);
export function FinalIsland(props: React.ComponentProps<typeof FinalIslandScene>) {
  const L = useAppLayout();
  // 맵 에셋(GROMO-2233): 이전에 받아 둔 새 버전은 이 화면이 뜰 때 한 번만 스냅샷으로 고정해 렌더러·nav·layout 에
  // 내려준다(렌더 중 교체 금지). 백그라운드 동기화는 완료돼도 다음 홈 진입부터 반영된다.
  // 플래그 off 면 캐시를 읽지 않고 항상 번들이다.
  const [mapAssets, setMapAssets] = useState<MapAssetSource>(() =>
    TILE_ISLAND ? promoteMapAssets('home') : BUNDLE_ASSETS,
  );
  // 캐시 이미지 디코드 실패 → 전역도, 이 화면의 스냅샷도 번들로 내린다(빈 섬 방지).
  const failMapAssets = useCallback((file: TilesetFile) => {
    demoteToBundle('home', undefined, file);
    setMapAssets(BUNDLE_ASSETS);
  }, []);
  useEffect(() => {
    if (TILE_ISLAND) void syncMapAssets('home');
  }, []);
  const [layered, setLayered] = useState(
    () =>
      CAN_PREVIEW_VILLAGE &&
      ((Platform.OS === 'web' &&
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('village') === 'layered') ||
        process.env.EXPO_PUBLIC_VILLAGE_PREVIEW === '1'),
  );
  const [navDebug, setNavDebug] = useState(false);
  const demoMotionStates =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('demo');
  return (
    <View style={{ flex: 1 }}>
      <FinalIslandScene
        key={layered ? 'layered' : 'original'}
        {...props}
        boardStatus={props.boardStatus ?? (demoMotionStates ? 'new-comment' : undefined)}
        observatoryRankState={
          props.observatoryRankState ?? (demoMotionStates ? 'rank-updated' : undefined)
        }
        shopState={props.shopState ?? (demoMotionStates ? 'purchasable' : undefined)}
        libraryState={props.libraryState ?? (demoMotionStates ? 'new-reading' : undefined)}
        layeredPreview={layered}
        mapAssets={mapAssets}
        onMapAssetsFail={failMapAssets}
        navDebug={navDebug}
      />
      {CAN_PREVIEW_VILLAGE && props.showHud !== false && props.showActions !== false && (
        <View
          style={{
            position: 'absolute',
            right: semanticTokens.spacing.page,
            top: Math.max(L.insets.top, semanticTokens.spacing.page),
            zIndex: 20,
          }}
        >
          <Btn
            id="village-preview-toggle"
            kind="sec"
            title={layered ? '기존 마을 보기' : '새 마을 미리보기'}
            onPress={() => setLayered((value) => !value)}
          />
          {TILE_ISLAND && (
            <Btn
              id="nav-debug-toggle"
              kind="sec"
              title={navDebug ? '이동 숨기기' : '이동 보기'}
              onPress={() => setNavDebug((value) => !value)}
            />
          )}
        </View>
      )}
    </View>
  );
}
