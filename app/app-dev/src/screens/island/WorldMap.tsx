import { IslandOcean, islandTerrain } from './IslandOcean';
import { NATIVE, useMapGesture, viewportShift } from './mapGesture';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Svg, { Defs, Pattern, Rect, Image as SvgImage } from 'react-native-svg';
import { isDemoMode } from '@/services/demoMode';
import {
  Animated,
  AppState,
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
import { formatDuration } from '@/i18n/format';
import { CatSprite, CatMotionInput } from '@/components/CatSprite';
import { outfitOf, type Outfit } from '@/components/CatOutfitLayers';
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
import { HomeNavigationHud } from './HomeNavigationHud';
import { Grid, Point, onLand, nearestLand, landPath } from '@/utils/world-grid';
import grids from '@/constants/world-v2.json';
import legacyDoorCoords from '@/constants/legacy-doors.json';
import { MotionContext } from '@/design-system/primitives';
import { Btn, C, Txt, Pic } from '@/design-system/patterns';
import { VillageScenery } from './VillageScenery';
import { ServerBuildCard } from './ServerBuildCard';
import { Ticking, useWakeAt } from '@/hooks/useNow';
import {
  TileTerrainCanvas,
  navDebugText,
  type NavDebug,
  type NavServerDebug,
  type NavWalk,
} from './TileTerrainCanvas';
import { debugClockPeriod } from './navDebugClock';
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
import { keepLabelInView } from '@/utils/island-camera';
import {
  loadNav,
  MS_PER_UNIT,
  navPath,
  stepDurationMs,
  tapToWorld,
  tilePath,
} from '@/utils/nav-path';
import { imageToWorld, worldToCell, worldToImage, type WorldPoint } from '@/utils/worldCoords';
import {
  publishMoveIntent,
  memberArrivalFilter,
  memberArrivedText,
  sessionSelfId,
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
  lookOf,
  newerLook,
  parseAppearanceEvent,
  type MemberLook,
} from '@/services/memberAppearance';
import {
  constructionPhase,
  normalizedConstructionProgress,
} from '@/screens/island/constructionProgress';
import { runBuildingEntryWalk, type BuildingTransitionTarget } from '@/services/buildingTransition';
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
import {
  TileFacilityOutline,
  TileFacilitySign,
  tileFacilityLayerSource,
  tileFacilityOutlineSource,
} from './TileFacilityDecoration';
import {
  TILE_FACILITIES,
  TILE_MAILBOX_Y_OFFSET,
  TILE_MAILBOX_PELICAN_RECT,
  facilityPressStyle,
  layoutFacilitySigns,
  facilityTouchBox,
} from './tileFacilities';
import { ImageTerrainFacilities } from './ImageTerrainFacilities';
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
// 홈 지도 확대·축소 한계. 최소 배율은 손가락으로 끄는 동안 바다를 미리 깔 범위도 정한다.
const MIN_ZOOM = 0.35,
  MAX_ZOOM = 2.6;
/**
 * 화면 마운트 때 쓸 맵 에셋 스냅샷(GROMO-2244, codex 지적 — 서버 `MovementRooms.java:46` 기준).
 * 서버 이동 엔진은 1단계에서 번들 nav.json 만 쓰므로, movementSync 빌드는 캐시 승격(promote)을
 * 건너뛰고 항상 번들(타일·레이아웃 포함)을 스냅샷으로 써 서버와 같은 nav 아티팩트를 보장한다 —
 * 아니면 맵 업데이트 뒤 앱 캐시 nav 와 서버 번들 nav 가 달라도 둘 다 navRevision=1 이라 불일치가
 * 안 잡혀 로컬 고양이가 서버 기준 통행 불가 지형을 지나거나 서버 경로로 강제 보정된다.
 */
export function initialMapAssets(
  tileIsland: boolean,
  movementSync: boolean,
  promote: () => MapAssetSource,
): MapAssetSource {
  if (movementSync) return BUNDLE_ASSETS;
  return tileIsland ? promote() : BUNDLE_ASSETS;
}
const pathDistance = (pts: readonly Point[]) => {
  let sum = 0;
  for (let idx = 1; idx < pts.length; idx++) {
    sum += Math.hypot(pts[idx].x - pts[idx - 1].x, pts[idx].y - pts[idx - 1].y);
  }
  return sum;
};
type WorldActorLayers = { world: React.ReactNode; overlay: React.ReactNode };

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
    fire: {
      x: d.fire.x,
      y: d.fire.y,
      r: 'rest',
      get label() {
        return t('home.a11y.campfire');
      },
      memberOnly: true,
      // 낮 연기와 밤 불꽃이 그려지는 영역을 함께 덮는다.
      hitbox: d.fire.hitbox,
    },
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
      r: 'raft',
      get label() {
        return t('home.a11y.raft');
      },
      memberOnly: true,
      visitorRoute: 'raft',
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
// 내 고양이 걸음 곡선 — Animated.timing 기본값(easing 을 안 줄 때)과 같다. 걷는 도중 자리 계산(livePosition)도 이것을 쓴다.
const WALK_EASE = Easing.inOut(Easing.ease);
// 고양이 이동(GROMO-2374) — left/top 대신 transform 값을 네이티브 드라이버로 옮겨 걷는 동안 JS 스레드가 프레임마다
// 레이아웃을 돌리지 않는다. 이 값은 네이티브로 넘어가므로 JS 드라이버 애니메이션·레이아웃 속성에 쓰지 않는다.
// 길이 0(동작 줄이기)은 네이티브로 보내면 한 프레임 뒤에야 끝나 걷기 사슬이 꼭짓점마다 밀린다 — 예전(JS 드라이버)처럼
// 그 자리에 바로 놓고 같은 호출 안에서 끝낸다.
function moveCat(
  xy: Animated.ValueXY,
  toValue: Point,
  duration: number,
  done?: Animated.EndCallback,
  easing?: (t: number) => number,
) {
  if (duration <= 0) {
    xy.setValue(toValue);
    done?.({ finished: true });
    return;
  }
  Animated.timing(xy, { toValue, duration, easing, ...NATIVE }).start(done);
}
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
  outfit,
}: {
  color: Color;
  outfit?: Outfit;
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
        moveCat(
          xy,
          next,
          reduce ? 0 : 130,
          ({ finished }) => {
            if (!finished) return;
            at.current = next;
            // 깊이는 layered 미리보기(scene)의 zIndex 에만 쓴다 — 운영에서는 걸음마다 다시 그리지 않는다(GROMO-2371).
            if (scene) setDepth(next.y);
            step();
          },
          Easing.linear,
        );
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
        left: 0,
        top: 0,
        transform: [
          { translateX: Animated.multiply(xy.x, s) },
          { translateY: Animated.multiply(xy.y, s) },
        ],
        zIndex: scene ? Math.round(depth) : undefined,
      }}
    >
      <CatSprite
        color={color}
        size={70 * s}
        motion={walking ? 'walking' : 'blink'}
        left={left}
        reduce={reduce}
        outfit={outfit}
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
  outfit,
}: {
  userId: string;
  color: Color;
  outfit?: Outfit;
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
      moveCat(xy, p, reduce ? 0 : durationMs, undefined, Easing.linear);
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
        left: 0,
        top: 0,
        transform: [
          { translateX: Animated.multiply(xy.x, s) },
          { translateY: Animated.multiply(xy.y, s) },
        ],
      }}
    >
      <CatSprite
        color={color}
        size={70 * s}
        motion={walking ? 'walking' : 'blink'}
        left={left}
        reduce={reduce}
        outfit={outfit}
      />
    </Animated.View>
  );
}
export type VillageDayNight = 'day' | 'night';

const localDayNight = (): VillageDayNight => {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? 'day' : 'night';
};

/** 기기 현지 시각의 낮(06~18시)·밤. 데모 모드는 낮으로 고정하고, 웹 ?demo&night 로 밤을 볼 수 있다. */
export function useVillageDayNight(): VillageDayNight {
  const demoParams =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null;
  const demo = isDemoMode();
  const demoNight = demo && demoParams?.has('night') === true;
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
  showMailboxMagazine = false,
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
  debugNow,
  buildingOffsets,
  pressedFacility,
  children,
}: {
  state: State;
  islandId?: string;
  fishing?: boolean;
  onSpot?: (p: Point) => void;
  emote?: string | null;
  showMailboxLetters?: boolean;
  /** 안 읽은 오늘 고양이 잡지(GROMO-2289) — 친구 편지 표시가 없을 때만 우체통 위 빨간 점. */
  showMailboxMagazine?: boolean;
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
  /** 틱 지연·대기 readout 시계 — FinalIslandScene 이 serverDebug flush 와 같은 동기 구간에서
   * 갱신한다(GROMO-2249 보완8 항목 2). navDebug 없이 호출하는 쪽(WorldMap.test.tsx)은 readout 자체를
   * 안 그리니 안 넘겨도 된다. */
  debugNow?: number;
  /** 타일 섬 서버 배치 — 기존 마을 건물 레이어·모션·알림을 이만큼 옮겨 그린다. */
  buildingOffsets?: BuildingOffsets;
  pressedFacility?: string | null;
  children?:
    | React.ReactNode
    | ((
        scale: number,
        project: (point: Point) => Point,
        baseScale: number,
      ) => React.ReactNode | WorldActorLayers);
}) {
  const L = useAppLayout(),
    grid: Grid = fishing ? grids.fishing : (village?.grid ?? grids.home),
    island = state.islands.find((item) => item.id === islandId) ?? homeIsland(state);
  // 타일 섬 지형 캔버스는 기존 마을 홈 섬 + 플래그일 때만. 낚시·새 마을 미리보기는 기존 Image 그대로.
  const tileTerrain = isTileIsland(village, fishing);
  const facilityDecorations = !village && !fishing;
  const reduceFacilityMotion = useContext(MotionContext) || state.settings.reduceMotion;
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
  const gesture = useMapGesture(camera);
  // 팬 핸들러는 첫 렌더에 한 번 만들어진다 — 타일 섬 여부는 ref 로 읽는다
  const tileTerrainRef = useRef(tileTerrain);
  tileTerrainRef.current = tileTerrain;
  const origin = useRef({ x: 0, y: 0, z: 1, dist: 0, anchorX: 0, anchorY: 0 }),
    frame = useRef({ x: 0, y: 0 }),
    drag = useRef(false),
    view = useRef<View>(null);
  const clamp = (c: typeof camera) => ({
    ...c,
    x: Math.max(0, Math.min(grid.w, c.x)),
    y: Math.max(0, Math.min(grid.h, c.y)),
    z: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.z)),
  });
  // 끄는 동안(GROMO-2373): state 는 그대로 두고 커밋된 배치를 c 카메라 자리로 옮겨 보이기만 한다.
  const show = (c: typeof camera) => {
    // 타일 섬의 Skia 캔버스는 화면 크기 표면이라 컨테이너 transform 으로 옮기면 끄는 동안 가장자리가 빈다 —
    // 그 경로(EXPO_PUBLIC_TILE_ISLAND)만 예전처럼 움직일 때마다 카메라를 커밋해 캔버스가 다시 그리게 한다
    if (tileTerrainRef.current) {
      setCamera(c);
      return;
    }
    const v = current.current,
      s = v.base * c.z;
    gesture.show(
      c,
      viewportShift(
        v,
        { left: v.width / 2 - c.x * s, top: v.height / 2 - c.y * s, scale: s },
        v.width,
        v.height,
      ),
    );
  };
  // 손을 떼면 보이는 카메라로 한 번만 다시 배치한다. transform 은 커밋 직후 useMapGesture 가 항등으로 되돌린다.
  const settle = () => {
    const c = gesture.release();
    if (c) setCamera(c);
  };
  const touches = (e: any) => e.nativeEvent.touches ?? [];
  const dist = (tp: any[]) =>
    tp.length > 1 ? Math.hypot(tp[0].pageX - tp[1].pageX, tp[0].pageY - tp[1].pageY) : 0;
  const midpoint = (tp: any[]) => ({
    x: (tp[0].pageX + tp[1].pageX) / 2 - frame.current.x,
    y: (tp[0].pageY + tp[1].pageY) / 2 - frame.current.y,
  });
  const begin = (tp: any[]) => {
    const v = current.current,
      c = gesture.visible(),
      s = v.base * c.z;
    const m = tp.length > 1 ? midpoint(tp) : { x: v.width / 2, y: v.height / 2 };
    origin.current = {
      ...c,
      dist: dist(tp),
      anchorX: c.x + (m.x - v.width / 2) / s,
      anchorY: c.y + (m.y - v.height / 2) / s,
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
          const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (o.z * dist(tp)) / o.dist)),
            m = midpoint(tp);
          show(
            clamp({
              x: o.anchorX - (m.x - v.width / 2) / (v.base * z),
              y: o.anchorY - (m.y - v.height / 2) / (v.base * z),
              z,
            }),
          );
        } else if (!o.dist) {
          const s = v.base * o.z;
          show(clamp({ x: o.x - g.dx / s, y: o.y - g.dy / s, z: o.z }));
        }
      },
      onPanResponderRelease: () => {
        settle();
        setTimeout(() => {
          drag.current = false;
        }, 80);
      },
      onPanResponderTerminate: () => {
        settle();
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
  const pressStyle = (id: string) =>
    facilityPressStyle(facilityDecorations && pressedFacility === id, reduceFacilityMotion);
  // 잘린 정적 그림(GROMO-2378)은 원화 rect 자리에 rect 크기로 놓는다 — 1536×1024 레이어와 같은 픽셀 위치.
  const facilityLayerBox = (b: Building) => {
    const r = TILE_FACILITIES[b];
    return {
      position: 'absolute' as const,
      left: at(b).left + r.x * scale,
      top: at(b).top + r.y * scale,
      width: r.w * scale,
      height: r.h * scale,
    };
  };
  // 끄는 동안에는 바다를 다시 깔지 않으므로, 카메라 한계(섬 안·최소 배율) 안에서 화면에 걸칠 수 있는 바다를 미리 깐다.
  const reachX = L.width / (2 * base * MIN_ZOOM),
    reachY = L.height / (2 * base * MIN_ZOOM),
    oceanCover = { left: -reachX, top: -reachY, right: grid.w + reachX, bottom: grid.h + reachY };
  const renderedActors =
    typeof children === 'function' ? children(scale, projectCurrentWorldPoint, base) : children;
  const actorLayers =
    renderedActors && typeof renderedActors === 'object' && 'world' in renderedActors
      ? renderedActors
      : { world: renderedActors, overlay: null };
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
      {/* 낚시·새 마을 미리보기 바다는 화면에 붙은 무늬라 지도 transform 밖에 둔다. */}
      {fishing ? (
        <Image
          source={require('@/assets/reference-v2/sea-tile.jpg')}
          resizeMode="repeat"
          style={StyleSheet.absoluteFill}
        />
      ) : village ? (
        <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <Pattern
              id="home-ocean"
              width={320 * scale}
              height={88 * scale}
              patternUnits="userSpaceOnUse"
            >
              <SvgImage
                href={villageAssets['terrain.png']}
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
      ) : null}
      {/* 지도 손가락 변환(GROMO-2373): 끄는 동안 이 컨테이너 하나만 움직이고 쉬는 동안은 항등이다. */}
      <Animated.View
        pointerEvents="box-none"
        collapsable={false}
        style={[
          StyleSheet.absoluteFill,
          { width: L.width, height: L.height, transform: gesture.transform },
        ]}
      >
        {!fishing && !village && (
          <IslandOcean
            left={left}
            top={top}
            scale={scale}
            night={dayNight === 'night'}
            cover={oceanCover}
          />
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
            reduceMotion={reduceFacilityMotion}
            pressedFacility={pressedFacility}
            showFacilityOutlines
          />
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
                    : islandTerrain[dayNight]
              }
              style={{ width: '100%', height: '100%' }}
              resizeMode="stretch"
            />
          )}
        </Pressable>
        {facilityDecorations && !tileTerrain && (
          <ImageTerrainFacilities
            left={left}
            top={top}
            scale={scale}
            baseScale={base}
            night={night}
            pressedFacility={pressedFacility}
            reduceMotion={reduceFacilityMotion}
          />
        )}
        {facilityDecorations &&
          island.buildings.map((b) => {
            const pelican = b === 'mail' && mailboxLetters;
            const rect = pelican ? TILE_MAILBOX_PELICAN_RECT : TILE_FACILITIES[b];
            return (
              rect && (
                <TileFacilityOutline
                  key={b}
                  rect={rect}
                  source={tileFacilityOutlineSource(pelican ? 'mail-pelican' : b, night)}
                  left={at(b).left}
                  top={at(b).top}
                  scale={scale}
                  pressed={pressedFacility === b}
                  reduceMotion={reduceFacilityMotion}
                />
              )
            );
          })}
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
                  source={tileFacilityLayerSource(b, night)}
                  style={{ ...facilityLayerBox(b), ...pressStyle(b) }}
                  resizeMode="stretch"
                />
              ))}
            {mailboxLetters && (
              <Image
                testID="mailbox-pelican"
                source={assets['characters/pelican/npc/on-mailbox.png']}
                style={{
                  ...pressStyle('mail'),
                  position: 'absolute',
                  left: at('mail').left + TILE_MAILBOX_PELICAN_RECT.x * scale,
                  top: at('mail').top + TILE_MAILBOX_PELICAN_RECT.y * scale,
                  width: TILE_MAILBOX_PELICAN_RECT.w * scale,
                  height: TILE_MAILBOX_PELICAN_RECT.h * scale,
                }}
                resizeMode="contain"
              />
            )}
            {mailboxLetters && (
              <VillageNotificationBadge
                testID="mailbox-new-indicator"
                accessibilityLabel={t('home.a11y.mailboxNewLetter')}
                scale={scale}
                style={{
                  ...pressStyle('mail'),
                  left: at('mail').left + 348 * scale,
                  top: at('mail').top + 520 * scale,
                }}
              />
            )}
            {!mailboxLetters && showMailboxMagazine && island.buildings.includes('mail') && (
              <VillageNotificationBadge
                testID="mailbox-magazine-indicator"
                accessibilityLabel={t('home.a11y.mailboxNewMagazine')}
                scale={scale}
                style={{
                  ...pressStyle('mail'),
                  left: at('mail').left + 348 * scale,
                  top: at('mail').top + 520 * scale,
                }}
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
                  ...pressStyle('hall'),
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
                  ...pressStyle('board'),
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
                  ...pressStyle('tower'),
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
                  ...pressStyle('shop'),
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
                  ...pressStyle('library'),
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
                ...pressStyle('fire'),
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
                ...facilityPressStyle(
                  facilityDecorations && pressedFacility === 'raft',
                  reduceFacilityMotion,
                  [
                    (TILE_FACILITIES.raft.x + TILE_FACILITIES.raft.w / 2 - 185) * scale,
                    (TILE_FACILITIES.raft.y + TILE_FACILITIES.raft.h - 835) * scale,
                    0,
                  ],
                ),
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
                  source={tileFacilityLayerSource(b, night)}
                  style={{
                    ...facilityLayerBox(b),
                    ...pressStyle(b),
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
          {actorLayers.world}
        </View>
        <View
          testID="facility-sign-overlay"
          pointerEvents="box-none"
          collapsable={false}
          style={StyleSheet.absoluteFill}
        >
          {actorLayers.overlay}
        </View>
      </Animated.View>
      {tileTerrain && navDebug && (
        <Txt
          testID="nav-debug-text"
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
          {navDebugText(navDebug.walk, mapAssets.kind, navDebug.server, debugNow)}
        </Txt>
      )}
    </View>
  );
}
// 이동 보기 오버레이(GROMO-2249) flush 결과 비교용 — 같으면 이전 state 를 그대로 써 TileTerrainCanvas
// 리렌더를 건너뛴다(보완 3). waitingSince·snapshotReceivedAt 도 비교에 넣는다(보완4 지적 1) — 둘 다
// 이벤트 때만 바뀌는 절대 시각이라 250ms 재시도 인터벌만으론 새 객체가 안 생기고, intent 전송으로
// sentAt 만 바뀌거나 정지 상태에서 같은 좌표의 새 Snapshot 으로 receivedAt 만 바뀌는 경우를 놓치지 않는다.
const sameImagePoint = (a: Point | null, b: Point | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
// 모든 점을 깊이 비교한다(보완4 지적 3) — 점 ≤ 100개라 비용은 무시한다(보완5 지적 1).
const samePathPoints = (a: Point[], b: Point[]) =>
  a.length === b.length && a.every((p, i) => sameImagePoint(p, b[i]));
// path 는 flush 마다 새 배열이라 참조가 다르면 비교가 필요하다. pathId(서버 경로 식별자)가 같아도 서버
// 재시작 뒤 재사용된 값일 수 있다(movementSync 가 pathId 역행을 허용) — 길이만 보고 "같다"고 끝내던
// pathId 지름길은 그 경우 중간 waypoint 가 달라져도 옛 경로를 그대로 남겼다(보완5 지적 1). 지름길 없이
// pathId 와 전 지점을 항상 함께 비교한다.
const sameImagePath = (
  a: Point[] | null,
  b: Point[] | null,
  aPathId: number | null,
  bPathId: number | null,
) => a === b || (!!a && !!b && aPathId === bPathId && samePathPoints(a, b));
const sameServerDebug = (a: NavServerDebug, b: NavServerDebug) =>
  a.status === b.status &&
  a.correctedAt === b.correctedAt &&
  a.waitingSince === b.waitingSince &&
  a.snapshotReceivedAt === b.snapshotReceivedAt &&
  sameImagePoint(a.predicted, b.predicted) &&
  sameImagePoint(a.snapshot, b.snapshot) &&
  sameImagePath(a.path, b.path, a.pathId, b.pathId);
// NavServerDebug 에 필드를 추가하면(또는 빼면) 이 타입이 깨진다 — sameServerDebug 도 같이 고치라는
// 컴파일 타임 잠금이다(GROMO-2249 보완8 항목 4).
export const SERVER_DEBUG_KEYS: Record<keyof NavServerDebug, true> = {
  status: true,
  path: true,
  pathId: true,
  snapshot: true,
  predicted: true,
  correctedAt: true,
  snapshotReceivedAt: true,
  waitingSince: true,
};
function FinalIslandScene({
  state,
  go,
  build,
  showHud = true,
  showActions = true,
  friendRequestCount,
  request,
  notify,
  dispatch,
  viewingIslandId,
  focusTutorial,
  motion,
  showMailboxLetters,
  showMailboxMagazine = false,
  boardStatus = null,
  observatoryRankState = 'normal',
  shopState = 'normal',
  libraryState = 'normal',
  onBuildingEntrySound,
  layeredPreview = false,
  onServerBuilt,
  onReturnFromVisit,
  visitHud,
  visitJoin,
  mapAssets = BUNDLE_ASSETS,
  onMapAssetsFail,
  navDebug = false,
}: {
  state: State;
  go: (r: Route, id?: string) => boolean | void;
  build: (b: Building) => void;
  showHud?: boolean;
  showActions?: boolean;
  friendRequestCount?: number;
  request?: Route | null;
  notify?: (s: string) => void;
  dispatch?: (a: { type: string; [key: string]: any }) => void;
  viewingIslandId?: string;
  focusTutorial?: { text: string; onPress: () => void; onSkip: () => void };
  motion?: CatMotionInput;
  showMailboxLetters?: boolean;
  /** 안 읽은 오늘 고양이 잡지 — 우체통 위 빨간 점(구경 중에는 끈다). */
  showMailboxMagazine?: boolean;
  boardStatus?: 'unread' | 'new-comment' | null;
  observatoryRankState?: ObservatoryRankState;
  shopState?: ShopMotionState;
  libraryState?: LibraryMotionState;
  /** 문 소스 확보 전까지는 선택적 연결 계약으로 두고 소리가 꺼져 있으면 호출하지 않는다. */
  onBuildingEntrySound?: (target: BuildingTransitionTarget, generation: number) => void;
  layeredPreview?: boolean;
  /** 서버 모드 홈 스냅샷 재조회 — 넘긴 화면(홈)에서만 서버 짓기 카드를 띄운다. */
  onServerBuilt?: () => void;
  /** 서버 방문은 현재 소속 섬을 변경하지 않고 구경만 끝낸다. */
  onReturnFromVisit?: () => void;
  /** 서버 방문 HUD(GROMO-2259) — 집중 중 인원(null 이면 줄을 숨긴다)·오늘 집중 분(없으면 숨긴다). */
  visitHud?: { focusCount: number | null; onFocusPress: () => void; todayMinutes?: number };
  /** 서버 방문 하단 가입 버튼(GROMO-2259) — 있으면 「원래 섬으로」 자리를 대신한다. */
  visitJoin?: { label: string; disabled: boolean; onPress: () => void };
  mapAssets?: MapAssetSource;
  onMapAssetsFail?: (file: TilesetFile) => void;
  /** 개발 전용 이동 보기 — 켜진 동안만 마지막 걷기를 기록한다. */
  navDebug?: boolean;
}) {
  // 구경 중이면 구경하는 섬을 그리고, 내 고양이·집중·건설 없이 둘러보기만 한다.
  // viewingIslandId는 방문 카드에서 들어온 읽기 전용 경로라 전역 소속/방문 상태를 바꾸지 않는다.
  const explicitVisit = !!viewingIslandId,
    // 방문 카드(viewingIslandId)로 연 섬은 내 홈 스냅샷으로 대신 그리지 않는다 — 기존 폴백 유지
    i = viewingIslandId ? viewIsland(state, viewingIslandId) : homeIsland(state),
    // 서버 모드 내 섬 홈이면 스냅샷(GROMO-2138) — 주민 색·오늘 집중을 서버 값으로 그린다
    facts = explicitVisit || state.visitingIslandId ? null : serverHome(state),
    visiting = explicitVisit || !!state.visitingIslandId,
    L = useAppLayout(),
    focusTarget = useSpotlightTarget(!!focusTutorial);
  const focusTutorialLatest = useRef(focusTutorial);
  focusTutorialLatest.current = focusTutorial;
  const mailboxLetters = !visiting && (showMailboxLetters ?? hasMailboxLetters(state, i.id));
  const mailboxMagazine = !visiting && showMailboxMagazine;
  const mailLabel = mailboxLetters
    ? t('home.door.mailNewLetter')
    : mailboxMagazine
      ? t('home.door.mailNewMagazine')
      : null;
  const serverConstruction = state.serverIslands?.clientConstruction;
  const trackedConstruction = facts
    ? serverConstruction?.islandId === facts.islandId
      ? serverConstruction
      : null
    : (i.construction ?? null);
  const renderedAt = Date.now();
  const progress = normalizedConstructionProgress(
    trackedConstruction
      ? { startedAt: trackedConstruction.startedAt, completesAt: trackedConstruction.endsAt }
      : null,
    renderedAt,
  );
  const activeBuilding =
    trackedConstruction && progress < 1 ? trackedConstruction.building : undefined;
  // 공사 그림은 단계 경계(15%·75%·완공)에서만 바뀌므로 그때만 지도를 다시 그린다 — App 은 분마다만 그린다(GROMO-2372)
  useWakeAt(
    trackedConstruction && progress < 1
      ? [0.15, 0.75, 1]
          .map(
            (f) =>
              trackedConstruction.startedAt +
              f * (trackedConstruction.endsAt - trackedConstruction.startedAt),
          )
          .find((at) => at > renderedAt)
      : null,
  );
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
  const buildingOffsets: BuildingOffsets = useMemo(() => {
    if (scene) return {};
    const offsets = TILE_ISLAND ? legacyLayoutOffsets(layout) : {};
    return {
      ...offsets,
      mail: { x: offsets.mail?.x ?? 0, y: (offsets.mail?.y ?? 0) + TILE_MAILBOX_Y_OFFSET },
    };
  }, [scene, layout]);
  // WorldMap 이 부모와 같은 낮·밤 값을 쓰도록 한 번만 계산해 내려준다.
  const dayNight = useVillageDayNight();
  const fireObject = scene?.objects.find((object) => object.kind === 'fire');
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
            : id === 'fire' && fireObject
              ? {
                  ...door,
                  x: fireObject.x,
                  y: fireObject.y + fireObject.h / 2,
                  hitbox: {
                    x: fireObject.x - fireObject.w / 2,
                    y: fireObject.y - fireObject.h,
                    w: fireObject.w,
                    h: fireObject.h,
                  },
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
  const [pressedFacility, setPressedFacility] = useState<string | null>(null);
  const reduceFacilityMotion = useContext(MotionContext) || state.settings.reduceMotion;
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
  const buildingEntryPending = useRef(false);
  const entryGeneration = useRef(0);
  useEffect(() => {
    buildingEntryPending.current = false;
  }, [showActions, positionKey]);
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
  const navigateOnArrival = (targetRoute: Route) => {
    setInteractiveMotion(null);
    if (state.settings.sound && (targetRoute === 'hall' || targetRoute === 'library')) {
      onBuildingEntrySound?.(targetRoute, ++entryGeneration.current);
    }
    try {
      return go(targetRoute) !== false;
    } catch (error) {
      buildingEntryPending.current = false;
      throw error;
    }
  };
  const scaleRef = useRef(1);

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
    };
  }, []);
  const xy = useRef(new Animated.ValueXY(pos)).current,
    token = useRef(0),
    location = useRef(pos),
    // 지금 걷는 구간(출발·도착·시작 시각·길이). 멈춰 있으면 null.
    segment = useRef<{ from: Point; to: Point; t0: number; ms: number } | null>(null);
  // 화면에 보이는 고양이 자리(이미지 px, GROMO-2374). xy 는 네이티브 드라이버 값이라 걷는 도중 값을 JS 에서 바로 못
  // 읽는다(stopAnimation 콜백·리스너는 네이티브 왕복이라 비동기). 지금 구간을 같은 곡선(WALK_EASE)으로 계산하고,
  // 멈춰 있으면 location 그대로다.
  const livePosition = () => {
    const g = segment.current;
    if (!g) return location.current;
    const k = WALK_EASE(Math.min(1, (Date.now() - g.t0) / g.ms));
    return { x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k };
  };
  // 타일 섬 = 플래그 + 기존 마을(새 마을 미리보기가 아님). 홈 섬 장면이라 낚시는 여기 오지 않는다.
  const tileNav = isTileIsland(scene);
  const facilityDecorations = !scene;
  const [navWalk, setNavWalk] = useState<NavWalk | null>(null);
  // background 전환(codex 지적, PR #1111 — WorldMap.tsx:1625) — 홈이 마운트된 채 background 로 가도
  // 언마운트·syncIslandId/me 변경 때만 채널 effect 가 정리돼 channel.close() 가 안 불린다. 서버는 소켓
  // 종료에서만 rooms.leave 하므로 OS 가 WebSocket 을 유지하면 다른 주민에게 내 actor 가 계속 남는다.
  // appActive 를 아래 syncIslandId 에 섞어 background 에서 null 로 만들면 채널 effect 의 기존 cleanup 이
  // close() 를 불러 방을 나가고, active 복귀 때 effect 가 다시 돌아 새로 구독·FullState 로 맞춘다.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => subscription.remove();
  }, []);
  // 이동 동기화(GROMO-2248) — 플래그·타일 섬·서버 홈일 때만 켠다. 꺼져 있으면 movement 가 null 이라 걷기는 이전과 같다.
  // 배경으로 깔린 홈(showActions=false — 집중 준비·잠금 안내·우체통 안내 뒤)은 조작이 없으니 열지 않는다(구독 = 방 입장).
  const syncIslandId =
    MOVEMENT_SYNC && tileNav && facts && showActions && appActive ? facts.islandId : null;
  // 채널 effect 의존성에 넣어 로그인 세션이 바뀌면(계정 전환 등) 묵은 me 로 연 채널을 그대로 쓰지 않는다.
  const me = getSession()?.userId;
  const movement = useRef<MovementController | null>(null),
    // 걷기 사슬이 도는 중인지 · 그 걷기의 done(서버 경로로 갈아타도 넘겨 준다) · 로컬 경로 셀(월드) · 걷는 중 받은 도착
    stepping = useRef(false),
    walkDone = useRef<(() => void) | undefined>(undefined),
    walkCells = useRef<WorldPoint[]>([]),
    arrival = useRef<Point | null>(null);
  const [remoteActors, setRemoteActors] = useState<MovementActor[] | null>(null);
  // 실시간으로 받은 다른 주민의 외양(GROMO-2390) — 홈 응답의 appearance 와 version 으로 합쳐 그린다
  const [looks, setLooks] = useState<Record<string, MemberLook>>({});
  // 같은 섬의 일시 해제(백그라운드)에는 유지하고, 섬이 바뀔 때만 비운다 — 복귀 때 홈 스냅숏은 다시 읽지 않아 옛 외양으로 되돌아간다
  useEffect(() => () => setLooks({}), [facts?.islandId]);
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
    segment.current = null;
    location.current = p;
    setPos(p);
    homePositions[positionKey] = p;
  };
  // 주어진 이미지 px 경로(출발점 포함)를 걷는다. 반환값·done 계약은 walk 그대로다(buildingTransition 이 의존).
  // msPerUnit 은 서버 경로를 걸을 때 서버 속도(1000/speed), 없으면 로컬 MS_PER_UNIT.
  const walkPath = (path: Point[], done?: () => void, msPerUnit?: number) => {
    const run = ++token.current;
    // 걷는 도중 멈추면 고양이는 구간 중간에 서 있다 — 첫 구간의 보이는 출발점으로 기억한다(livePosition).
    let from = livePosition();
    xy.stopAnimation();
    segment.current = null;
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
        if (!done && pathDistance(path) >= 180) {
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
      const ms = state.settings.reduceMotion
        ? 0
        : tileNav
          ? stepDurationMs(
              imageToWorld(prev, sizeOf(grid)),
              imageToWorld(p, sizeOf(grid)),
              msPerUnit,
            )
          : 95;
      segment.current = { from, to: p, t0: Date.now(), ms };
      moveCat(
        xy,
        p,
        ms,
        ({ finished }) => {
          if (finished) {
            segment.current = null;
            from = p;
            location.current = p;
            // 월드 단위 정본(location)은 Movement 연결(2단계) 때 저장 형식까지 옮긴다. 그때까지 homePositions 는 px.
            // pos state 는 layered 미리보기의 zIndex 에만 쓴다 — 운영에서는 걸음마다 지도 전체를 다시 그리지 않는다(GROMO-2371).
            if (layeredPreview) setPos(p);
            homePositions[positionKey] = p;
            next();
          }
        },
        WALK_EASE,
      );
    };
    next();
    return true;
  };
  const walk = (target: Point, done?: () => void) => {
    if (tiltTimer.current) clearTimeout(tiltTimer.current);
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
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
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
      // 네이티브 드라이버 값은 stopAnimation 콜백이 비동기라 지금 자리는 걷는 구간으로 계산한다(GROMO-2374).
      const here = livePosition();
      xy.stopAnimation();
      segment.current = null;
      location.current = here;
      walkCells.current = waypoints;
      const hereWorld = imageToWorld(here, size);
      const rest = remainingPath([start, ...waypoints], hereWorld);
      // 연결 구간(지금 자리 → 갈아탄 경로의 첫 꼭짓점)도 통행 가능한 경로여야 한다 — 직선은
      // 장애물의 다른 쪽을 지날 수 있어(로컬 예측과 서버 경로가 반대편일 때) 로컬 A* 로 잇는다.
      const target = rest[0] ?? waypoints[waypoints.length - 1] ?? start;
      const connect = navPath(activeNav(mapAssets, navBuildings), hereWorld, target);
      // connect 가 비었는데 같은 셀도 아니면(같은 셀이라 비는 정상 경우와 구분) 로컬 예측과 서버 경로가 다른
      // 통행 영역·맵 버전이라 이을 수 없다는 뜻이다 — 직선으로 장애물을 뚫지 않고 서버 출발점(정본)으로
      // 즉시 맞춘 뒤 서버 경로를 그대로 걷는다.
      if (!connect.length && !cellEq(hereWorld, target)) {
        const startImage = worldToImage(start, size);
        place(startImage);
        walkPath(
          [startImage, ...waypoints.map((p) => worldToImage(p, size))],
          walkDone.current,
          msPerUnit,
        );
        return;
      }
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
  const applyAppearance = useCallback((body: unknown, islandId: string) => {
    const changed = parseAppearanceEvent(body, islandId);
    if (!changed) return;
    setLooks((prev) => {
      const next = newerLook(prev[changed.userId], changed.look)!;
      return next === prev[changed.userId] ? prev : { ...prev, [changed.userId]: next };
    });
  }, []);
  // 이동 동기화가 꺼진 빌드(기본·웹)도 주민 외양은 실시간으로 받는다 — 그 섬 events 토픽만 여는 가벼운 채널.
  // 이동 채널이 열리는 조건(아래 effect)과 겹치지 않아 한 섬에 events 구독은 하나뿐이다.
  const eventsOnlyIslandId =
    !(syncIslandId && me) && facts && showActions && appActive ? facts.islandId : null;
  useEffect(() => {
    if (!eventsOnlyIslandId) return;
    const channel = stompIslandChannel({
      islandId: eventsOnlyIslandId,
      presence: false,
      emote: false,
      events: true,
      onEvent: (body) => applyAppearance(body, eventsOnlyIslandId),
      onOpen: () => {},
      onError: () => {},
    });
    return () => channel.close();
  }, [eventsOnlyIslandId, applyAppearance]);
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
    const arrivals = memberArrivalFilter(syncIslandId, sessionSelfId);
    channel = stompIslandChannel({
      islandId: syncIslandId,
      presence: false,
      emote: false,
      movement: true,
      // 홈 = 내 소속 섬이라 주민 소식(GROMO-2311) 구독 조건을 늘 만족한다 — 방문(facts=null)에는 이 채널이 열리지 않는다
      events: true,
      onEvent: (body) => {
        const type = (body as { type?: unknown } | null)?.type;
        if (type === 'island.member.arrived') {
          const arrived = arrivals(body);
          if (arrived) notifyRef.current?.(memberArrivedText(arrived));
        } else if (type === 'member.appearance.updated') applyAppearance(body, syncIslandId);
        else controller.onMessage(body);
      },
      onOpen: () => {},
      // 이동 채널 영구 거절(STOMP ERROR·NOT_A_MEMBER)일 때만 이 화면 동안 동기화를 끄고 로컬 걷기·Wanderer 로
      // 돌아간다 — 토스트는 없다. 그 외 오류 큐 코드(예: 속도 제한)는 onError 로만 오고 동기화는 그대로 둔다.
      onMovementDenied: () => {
        // 섬 전환으로 이미 해제된 옛 채널의 늦은 거절일 수 있다 — 소유권을 먼저 확인해 새 컨트롤러를 끄지 않는다.
        if (movement.current !== controller) return;
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
  // 이동 보기 오버레이(GROMO-2249) — 서버 확정 경로·스냅샷·예측 오차. navDebug 가 꺼져 있으면 아무것도 계산·구독하지 않는다(비용 0).
  const [serverDebug, setServerDebug] = useState<NavServerDebug | null>(null);
  // flush 가 비교·배칭에 쓰는 최신값 거울(GROMO-2249 보완8 항목 2) — setState 는 비동기라 같은 tick
  // 안에서 state 클로저가 묵을 수 있다. ref 는 항상 바로 갱신해 다음 flush 가 최신값과 비교한다.
  const serverDebugRef = useRef<NavServerDebug | null>(null);
  // 틱 지연·대기 readout 시계(GROMO-2249 보완4 지적 2 · 보완8 항목 2) — serverDebug 가 flush 로 실제
  // 바뀔 때는 그 flush 와 같은 동기 구간에서 Date.now() 로 맞춰(아래 flush, React 18 자동 배칭) 렌더가
  // 1번만 늘어난다. 그 뒤는 아래 별도 effect 의 navDebugClock.debugClockPeriod 규칙대로 이어간다.
  const [debugNow, setDebugNow] = useState(() => Date.now());
  useEffect(() => {
    if (!navDebug || !tileNav) {
      setServerDebug(null);
      serverDebugRef.current = null;
      return;
    }
    const controller = movement.current;
    const size = sizeOf(grid);
    // 걷는 동안 화면에 보이는 고양이 위치는 flush 때 livePosition() 으로 계산한다 — location.current 는
    // 구간이 끝나야 갱신돼 걷는 중엔 전 꼭짓점에 머문다. 오버레이 화살표·서버 Δ 가 긴 구간에서 예측 오차를
    // 잘못 보여준다(GROMO-2249 보완7 지적 2). 둘 다 1x 이미지 px 공간이라 px→world 변환이 필요 없다(worldCoords
    // 의 WorldPoint 가 아니다). xy 는 네이티브 드라이버 값이라 리스너를 걸면 매 프레임 네이티브→JS 이벤트가
    // 오므로 걸지 않는다(GROMO-2374).
    // 100ms 쓰로틀 — controller.subscribe() 는 스냅샷마다(최대 20Hz) 올 수 있어 마지막 반영 이후 100ms 안이면 미뤄서 합친다.
    let lastFlush = 0,
      timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      lastFlush = Date.now();
      timer = null;
      // 컨트롤러가 없으면(동기화 off·비홈이거나 아직 안 열렸다) 동기화 자체가 꺼진 것과 같다 — "전부 null"
      // 객체 대신 server 자체를 비워 TileTerrainCanvas 쪽 판정이 상시 켜지지 않게 한다(GROMO-2249 보완 — 항목 2).
      // movement.current(살아있는 ref)가 아니라 캡처한 controller 로 판정한다 — 거절·언마운트 정리는 항상
      // controller.deny() 를 먼저 부르고서 movement.current 를 null 로 비우므로, 거절은 아래 st.denied 로 이미
      // 갈린다. 산 ref 로 판정하면 거절 직후 movement.current 가 비는 순간 off 로 오판한다.
      if (!controller) {
        setServerDebug(null);
        serverDebugRef.current = null;
        return;
      }
      const st = controller.state();
      const next: NavServerDebug = st.denied
        ? // 거절(controller.deny())되면 lastPath·lastSnapshot 은 컨트롤러 안에 그대로 남는다 — 오버레이까지
          // 묵은 경로·스냅샷을 계속 그리지 않게 통째로 비운다(지적 3). status 로 "서버 없음"과 구분한다(보완 5).
          {
            status: 'denied',
            path: null,
            pathId: null,
            snapshot: null,
            predicted: null,
            correctedAt: null,
            snapshotReceivedAt: null,
            waitingSince: null,
          }
        : {
            status: 'live',
            path: st.lastPath
              ? [st.lastPath.start, ...st.lastPath.waypoints].map((p) => worldToImage(p, size))
              : null,
            // 경로 비교 1순위(보완4 지적 3) — 서버 경로 식별자. lastPath 가 없으면(아직 PathAccepted 전) null.
            pathId: st.lastPath?.pathId ?? null,
            snapshot: st.lastSnapshot ? worldToImage(st.lastSnapshot, size) : null,
            // 걷는 중엔 구간 중간값(livePosition) — 멈춰 있으면 location.current 와 같다(폴백, 지적 2).
            predicted: livePosition(),
            correctedAt: st.lastCorrectionAt,
            // state() 가 수신 시각을 그대로 준다(GROMO-2249 보완) — 틱 지연(now - 이 값)은 readout 이 그릴 때
            // 계산해, 절대 시각이라 메시지가 안 와도 값이 그대로다(아래 shallow 비교가 매번 새 객체를 안 만든다).
            snapshotReceivedAt: st.lastSnapshot?.receivedAt ?? null,
            waitingSince: st.sentAt,
          };
      // path·snapshot·predicted·correctedAt·status 가 이전과 같으면 아무것도 하지 않아 리렌더를
      // 건너뛴다 — 시간값은 비교하지 않는다(보완 3). ref 는 항상 최신이라 효과 클로저가 묵어도 최신값과
      // 비교한다. 바뀐 경우에만 serverDebug 와 debugNow 를 같은 동기 구간에서 함께 올려 React 18 자동
      // 배칭으로 렌더가 1번만 늘어난다(보완8 항목 2) — 전에는 debugNow 를 WorldMap 쪽 참조 deps effect 가
      // 따로 뒤쫓아 flush 마다 렌더가 1번 더 늘었다.
      if (!serverDebugRef.current || !sameServerDebug(serverDebugRef.current, next)) {
        serverDebugRef.current = next;
        setServerDebug(next);
        setDebugNow(Date.now());
      }
    };
    const schedule = () => {
      const wait = 100 - (Date.now() - lastFlush);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    };
    schedule();
    const unsubscribe = controller?.subscribe(schedule) ?? (() => {});
    // 서버 응답·스냅샷이 끊겨 구독 콜백이 안 와도 오버레이가 켜진 동안은 250ms 마다 같은 flush 를 다시
    // 돌려 거절(deny) 처럼 콜백 없는 상태 변화도 집어 든다. 내용이 그대로면 위 shallow 비교가 리렌더까진
    // 만들지 않는다(지적 2·보완 3). 컨트롤러가 없으면(동기화 off) flush 는 매번 같은 early-return 뿐이라
    // 인터벌을 만들지 않는다 — 나중에 컨트롤러가 생기는(교체) 경우는 deps(syncIslandId·me) 로 이 effect
    // 가 다시 돌며 새로 잡는다(보완9 항목 2).
    const interval = controller ? setInterval(flush, 250) : null;
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
    // me: 컨트롤러 교체(계정 전환 등)를 추적해 effect 를 다시 돌려 새 controller 를 다시 캡처한다(보완 4).
  }, [navDebug, tileNav, grid, syncIslandId, me]);
  // 깜빡임·readout 시계 체인(GROMO-2249 보완4 지적 2 · 보완8 항목 2 · 보완9 항목 1) — flush 효과와는
  // 별도다. navDebugClock.debugClockPeriod 가 이제 live 여부만 보므로(보정 창 50ms 분기 제거, 보완9
  // 항목 1) deps 도 debugLive 하나면 된다 — 보정이 와도(correctedAt 변경) 주기가 안 바뀌니 이 effect 를
  // 다시 돌릴 이유가 없다. serverDebug 참조 전체를 deps 로 두면(이전 버전의 WorldMap 쪽 effect 가
  // 그랬다) flush 마다 이 effect 도 다시 돌아 debugNow 를 또 갱신해 렌더가 1번 더 늘었다(위 flush 가
  // 이미 같은 동기 구간에서 처리한다).
  const debugLive = serverDebug?.status === 'live';
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      setDebugNow(Date.now());
      const period = debugClockPeriod(serverDebugRef.current);
      if (period === null) return;
      id = setTimeout(tick, period);
    };
    const period0 = debugClockPeriod(serverDebugRef.current);
    if (period0 === null) return;
    id = setTimeout(tick, period0);
    return () => clearTimeout(id);
  }, [debugLive]);
  useEffect(() => {
    const p = initial();
    location.current = p;
    xy.setValue(p);
    segment.current = null;
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
          navigateOnArrival(request);
        } else {
          walk(d, () => {
            navigateOnArrival(request);
          });
        }
      }
    }
  }, [request]);

  const wanderers = useMemo(() => {
    const myId = getSession()?.userId;
    // 서버 주민 색은 고른 사람만 — catColor null 은 임의 색으로 채우지 않는다
    const others = facts
      ? facts.members
          .filter((m) => m.id !== myId && m.catColor)
          .map((m) => ({ color: catColor(m.catColor), outfit: lookOf(looks, m.id, m) }))
      : i.members
          .filter((m) => m.id !== 'me')
          .map((m) => ({ color: m.color as Color, outfit: undefined }));
    // 모자란 자리를 보충 색으로 채우는 연출은 목업 섬에서만 — 서버 홈엔 없는 주민을 세우지 않는다
    const spare = facts
      ? []
      : (['white', 'gray', 'ginger', 'calico', 'cream', 'black'] as Color[])
          .filter((c) => c !== state.color && !others.some((o) => o.color === c))
          .map((color) => ({ color, outfit: undefined }));
    return [...others, ...spare].slice(0, 2);
  }, [i.members, facts, state.color, looks]);
  // Child positions scale with the camera, rather than being pasted onto a cropped image.
  const actors = (s: number, project: (point: Point) => Point, baseScale: number) => {
    scaleRef.current = s;
    const catSize = 70 * s;
    const hitSize = Math.max(semanticTokens.size.tapMin, catSize);
    const visibleDoors = Object.entries(doors)
      // 방문 카드에서 연 읽기 전용 화면은 낚시섬 관전만 연다. 기존 방문자 홈은 회관·게시판도 열 수 있다.
      .filter(([, d]) =>
        explicitVisit
          ? !!d.visitorRoute && d.visitorRoute !== 'raft'
          : d.building && !i.buildings.includes(d.building)
            ? false
            : d.memberOnly
              ? !visiting || !!d.visitorRoute
              : !!d.building,
      );
    const facilityRects = Object.fromEntries(
      visibleDoors.flatMap(([id, d]) => {
        const r = facilityDecorations ? TILE_FACILITIES[id] : undefined;
        const o = d.building ? buildingOffsets[d.building] : undefined;
        return r ? [[id, { ...r, x: r.x + (o?.x ?? 0), y: r.y + (o?.y ?? 0) }]] : [];
      }),
    );
    const signBoxes = layoutFacilitySigns(
      Object.entries(facilityRects).map(([id, rect]) => ({ id, rect, label: doors[id].label })),
      s,
      L.fontScale,
      baseScale,
    );
    const signs: React.ReactNode[] = [];
    const screenOrigin = project({ x: 0, y: 0 });
    const world = (
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
        {visibleDoors.map(([id, d]) => {
          const facilityRect = facilityRects[id];
          // 새 편지 그림 전체를 누를 수 있게 하되, 팻말 위치는 우체통 기준으로 유지한다.
          const touchRect =
            facilityRect && id === 'mail' && mailboxLetters
              ? {
                  ...TILE_MAILBOX_PELICAN_RECT,
                  x: facilityRect.x + TILE_MAILBOX_PELICAN_RECT.x - TILE_FACILITIES.mail.x,
                  y: facilityRect.y + TILE_MAILBOX_PELICAN_RECT.y - TILE_FACILITIES.mail.y,
                }
              : facilityRect;
          const hitbox = touchRect ?? d.hitbox ?? { x: d.x - 60, y: d.y - 95, w: 120, h: 125 };
          // 홈 뗏목 그림 가장자리에 터치 여유를 주고, 축소해도 중심을 유지한다.
          const raftPadding = primitiveTokens.space[2];
          const raftTouchWidth = Math.max(
            semanticTokens.size.tapMin,
            hitbox.w * s + raftPadding * 2,
          );
          const raftTouchHeight = Math.max(
            semanticTokens.size.tapMin,
            hitbox.h * s + raftPadding * 2,
          );
          const raftTouchBox =
            id === 'raft' && !scene
              ? {
                  left: (hitbox.x + hitbox.w / 2) * s - raftTouchWidth / 2,
                  top: (hitbox.y + hitbox.h / 2) * s - raftTouchHeight / 2,
                  width: raftTouchWidth,
                  height: raftTouchHeight,
                }
              : undefined;
          const onPress = () => {
            if (!visiting) {
              if (buildingEntryPending.current) return;
              // 배 메뉴는 걷기와 갸웃 모션이 끝나기를 기다리지 않고 바로 연다.
              if (id === 'raft') return go(d.r);
              if (d.direct) {
                return navigateOnArrival(d.r);
              }
              buildingEntryPending.current = true;
              return runBuildingEntryWalk(
                (onArrival) => walk(d, onArrival),
                () => navigateOnArrival(d.r),
                () => {
                  buildingEntryPending.current = false;
                },
              );
            }
            if (d.visitorRoute) return go(d.visitorRoute, i.id);
            // 구경 중: 고양이가 걷지 않고 바로 연다. 회관은 책상 없이 섬 정보 카드로, 게시판만 열람
            if (d.building === 'hall') go('manage');
            else if (d.building === 'board') go('board');
            else if (d.building === 'gram') return;
            else notify?.(t('home.door.membersOnly'));
          };
          if (facilityRect)
            signs.push(
              <Pressable
                key={id}
                collapsable={false}
                testID={`building-name-${id}`}
                accessible={false}
                onPress={onPress}
                onPressIn={() => setPressedFacility(id)}
                onPressOut={() =>
                  setPressedFacility((current) => (current === id ? null : current))
                }
                hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                style={{
                  position: 'absolute',
                  zIndex: 2001,
                  ...signBoxes[id],
                  // 화면 가장자리에 걸친 팻말이 반쯤 잘리지 않게 민다 — 건물이 화면 안이면(기본 카메라의 우체통) 안으로, 밖이면 밖으로
                  left:
                    keepLabelInView(
                      screenOrigin.x + signBoxes[id].left + signBoxes[id].width / 2,
                      signBoxes[id].width,
                      L.insets.left,
                      L.width - L.insets.right,
                    ) -
                    signBoxes[id].width / 2,
                  top: screenOrigin.y + signBoxes[id].top,
                }}
              >
                <TileFacilitySign
                  width={signBoxes[id].width}
                  height={signBoxes[id].height}
                  label={d.label}
                  zoom={s / baseScale}
                  pressed={pressedFacility === id}
                  reduceMotion={reduceFacilityMotion}
                />
              </Pressable>,
            );
          return (
            <React.Fragment key={id}>
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={
                  id === 'mail' && mailLabel
                    ? mailLabel
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
                onPress={onPress}
                onPressIn={() => facilityDecorations && setPressedFacility(id)}
                onPressOut={() =>
                  setPressedFacility((current) => (current === id ? null : current))
                }
                style={{
                  position: 'absolute',
                  left: hitbox.x * s,
                  top: hitbox.y * s,
                  width: hitbox.w * s,
                  height: hitbox.h * s,
                  minWidth: 44,
                  minHeight: 44,
                  zIndex: scene ? 2000 : undefined,
                  ...raftTouchBox,
                  ...(touchRect ? facilityTouchBox(touchRect, s) : {}),
                }}
              />
            </React.Fragment>
          );
        })}
        {/* 주민 고양이 두 마리: 주민 색을 우선 쓰고, 모자라면 내 색과 다른 색으로 채운다 */}
        {!remoteActors &&
          wanderers.map(({ color, outfit }, n) => (
            <Wanderer
              key={color + n}
              color={color}
              outfit={outfit}
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
          const member = facts?.members.find((m) => m.id === a.userId);
          const color = member?.catColor;
          return color ? (
            <RemoteResident
              key={a.userId}
              userId={a.userId}
              color={catColor(color)}
              outfit={lookOf(looks, a.userId, member)}
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
              // 발 기준점 맞춤은 고정 left/top, 걷기는 네이티브 드라이버 transform(GROMO-2374) — 터치 영역도 같이 옮겨진다.
              left: -hitSize / 2,
              top: -(catSize / 2 + hitSize / 2),
              transform: [
                { translateX: Animated.multiply(xy.x, s) },
                { translateY: Animated.multiply(xy.y, s) },
              ],
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
                  outfit={outfitOf(state)}
                />
              </View>
            </Pressable>
          </Animated.View>
        )}
      </>
    );
    return { world, overlay: signs };
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
    hudAvailable = Math.max(0, L.width - hudLeft - hudRight),
    hudMax = visiting ? Math.min(L.width / 2, hudAvailable) : hudAvailable,
    rewardCount = claimableQuestRewardCount(state.rewards, i.id),
    showQuestIndicator =
      showHud &&
      showActions &&
      !visiting &&
      i.buildings.includes('board') &&
      (i.quests.length > 0 || rewardCount > 0);
  const departFocus = () => {
    if (buildingEntryPending.current) return;
    // 집중하기는 뗏목까지 걸어가지 않고 바로 항해 화면으로 넘어간다 — 걷는 시간만큼 기다리게 했다.
    focusTutorialLatest.current?.onPress();
    go('focusTravel');
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
        pressedFacility={pressedFacility}
        mapAssets={mapAssets}
        onMapAssetsFail={onMapAssetsFail}
        navDebug={
          tileNav && navDebug
            ? { nav: activeNav(mapAssets, navBuildings), walk: navWalk, server: serverDebug }
            : null
        }
        debugNow={debugNow}
        islandId={i.id}
        boardStatus={visiting ? null : boardStatus}
        observatoryRankState={observatoryRankState}
        shopState={shopState}
        libraryState={visiting ? 'normal' : libraryState}
        showMailboxLetters={mailboxLetters}
        showMailboxMagazine={mailboxMagazine}
        hiddenVillageBuilding={activeBuilding}
        dayNight={dayNight}
        onSpot={
          visiting
            ? undefined
            : (p) => {
                if (!buildingEntryPending.current) walk(p);
              }
        }
        children={actors}
      />
      {showHud && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: hudTop,
            left: hudLeft,
            width: visiting ? undefined : hudMax,
            zIndex: 10,
            alignItems: 'flex-start',
          }}
        >
          {!visiting ? (
            <HomeNavigationHud
              name={i.name}
              clock={todayClock}
              color={state.color}
              outfit={outfitOf(state)}
              requests={
                friendRequestCount ??
                (state.friends ?? []).filter((f) => f.status === 'received').length
              }
              go={go}
              interactive={showActions}
            />
          ) : (
            <View
              pointerEvents="none"
              style={{
                backgroundColor: `${semanticTokens.color.surface}B3`,
                borderRadius: semanticTokens.radius.full,
                paddingVertical: primitiveTokens.space[2],
                paddingHorizontal: semanticTokens.spacing.component,
                maxWidth: hudMax,
              }}
            >
              <Txt kind="meta" style={{ fontSize: 13, lineHeight: 18.85, fontWeight: '600' }}>
                {t('home.hud.visiting', { name: i.name })}
              </Txt>
              {visitHud?.todayMinutes != null && (
                <Txt kind="meta" style={{ fontSize: 13, lineHeight: 18.85, fontWeight: '600' }}>
                  {t('home.hud.todayFocusVisitor', {
                    time: formatDuration(visitHud.todayMinutes * 60),
                  })}
                </Txt>
              )}
            </View>
          )}
          {visiting && visitHud && visitHud.focusCount !== null && (
            <Pressable
              testID="visit-focus-count"
              accessibilityRole="button"
              accessibilityHint={t('home.hud.focusingNowHint')}
              onPress={visitHud.onFocusPress}
              style={{
                marginTop: componentTokens.homeQuestIndicator.hudGap,
                minHeight: semanticTokens.size.tapMin,
                justifyContent: 'center',
                // 위 HUD 알약과 같은 반투명 Paper 표면
                backgroundColor: `${semanticTokens.color.surface}B3`,
                borderRadius: semanticTokens.radius.full,
                paddingVertical: primitiveTokens.space[2],
                paddingHorizontal: semanticTokens.spacing.component,
              }}
            >
              <Txt kind="meta" style={{ fontSize: 13, lineHeight: 18.85, fontWeight: '600' }}>
                {visitHud.focusCount > 0
                  ? t('home.hud.focusingNow', { count: visitHud.focusCount })
                  : t('home.hud.quietNow')}
              </Txt>
            </Pressable>
          )}
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
                  {/* 공사 중 남은 분·진행 막대만 매초 다시 그린다(GROMO-2372) */}
                  {i.construction ? (
                    <Ticking>
                      {(now) =>
                        t('home.buildMinutesLeft', {
                          count: Math.max(0, Math.ceil((i.construction!.endsAt - now) / 60000)),
                        })
                      }
                    </Ticking>
                  ) : (
                    t('home.buildProgress', {
                      current: balance(i),
                      total: buildingCost(i, next!),
                    })
                  )}
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
                <Ticking ms={i.construction ? 1000 : null}>
                  {(now) => (
                    <View
                      style={{
                        height: '100%',
                        width: `${i.construction ? Math.max(0, Math.min(100, (100 * (now - i.construction.startedAt)) / (i.construction.endsAt - i.construction.startedAt))) : Math.min(100, (balance(i) / buildingCost(i, next!)) * 100)}%`,
                        backgroundColor: '#FFA6BC',
                      }}
                    />
                  )}
                </Ticking>
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
                : { right: focusButtonInset(L).right }),
              bottom: focusButtonInset(L).bottom,
            }}
          >
            {visiting && visitJoin ? (
              <Btn
                kind="butter"
                title={visitJoin.label}
                id="visit-join"
                disabled={visitJoin.disabled}
                onPress={visitJoin.onPress}
              />
            ) : visiting ? (
              <Btn
                kind="butter"
                title={t('home.returnToMyIsland')}
                id="visit-return"
                onPress={() => {
                  if (onReturnFromVisit) return onReturnFromVisit();
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
    </TutorialScene>
  );
}

// 개발 빌드 또는 명시적인 QA 빌드에서만 제공하는 로컬 표시 전환이다.
const CAN_PREVIEW_VILLAGE = __DEV__ || process.env.EXPO_PUBLIC_VILLAGE_PREVIEW === '1';
const sizeOf = (g: { w: number; h: number }) => ({ imageWidth: g.w, imageHeight: g.h });
// 두 월드 점이 같은 통행 셀인지 — 연결 경로(navPath)가 비어도 되는 정상 경우(같은 셀)를 가려낸다.
const cellEq = (a: WorldPoint, b: WorldPoint) => {
  const ca = worldToCell(a),
    cb = worldToCell(b);
  return ca.cx === cb.cx && ca.cy === cb.cy;
};
// 화면 스냅샷(GROMO-2233)의 nav.json 을 완공 목록별로(미완공 건물 자리는 통행). 같은 소스면 같은 JSON 객체라 loadNav 의 캐시가 맞는다.
const activeNav = (assets: MapAssetSource, completed: readonly string[]) =>
  loadNav(readMapJson('nav.json', bundledNavJson, assets) as any, completed);
/** 홈 오른쪽 아래 「집중 시작」 동그라미 버튼(지름 88)의 자리 — 그 위에 붙는 홈 물건(잡지)도 같은 값을 쓴다. */
export const FOCUS_BUTTON_SIZE = 88;
export function focusButtonInset(L: {
  landscape: boolean;
  insets: { right: number; bottom: number };
}) {
  return {
    right: L.landscape ? Math.max(56, L.insets.right + 4) : 20,
    bottom: L.landscape ? Math.max(22, L.insets.bottom) : Math.max(44, L.insets.bottom + 10),
  };
}

export function FinalIsland(props: React.ComponentProps<typeof FinalIslandScene>) {
  const L = useAppLayout();
  // 맵 에셋(GROMO-2233): 이전에 받아 둔 새 버전은 이 화면이 뜰 때 한 번만 스냅샷으로 고정해 렌더러·nav·layout 에
  // 내려준다(렌더 중 교체 금지). 백그라운드 동기화는 완료돼도 다음 홈 진입부터 반영된다.
  // 플래그 off 면 캐시를 읽지 않고 항상 번들이다.
  const [mapAssets, setMapAssets] = useState(() =>
    initialMapAssets(TILE_ISLAND, MOVEMENT_SYNC, () => promoteMapAssets('home')),
  );
  // 캐시 이미지 디코드 실패 → 전역도, 이 화면의 스냅샷도 번들로 내린다(빈 섬 방지).
  const failMapAssets = useCallback((file: TilesetFile) => {
    demoteToBundle('home', undefined, file);
    setMapAssets(BUNDLE_ASSETS);
  }, []);
  // 동기화 빌드(MOVEMENT_SYNC)에서도 그대로 돈다 — 캐시는 갱신되지만 initialMapAssets 가 항상 번들로
  // 고정하므로(위) 이 화면·다음 마운트 모두 반영되지 않는다(서버와 같은 nav 아티팩트를 유지하는 트레이드오프).
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
  const demoMotionStates = isDemoMode();
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
            top:
              Math.max(L.insets.top, semanticTokens.spacing.page) +
              2 * semanticTokens.size.tapMin +
              primitiveTokens.space[4],
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
