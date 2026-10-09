import React, { useEffect, useMemo, useRef, useState } from 'react';
import Svg, { Defs, Pattern, Rect, Image as SvgImage } from 'react-native-svg';
import { isDemoMode } from '@/services/demoMode';
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
import { Btn, C, Txt, Pic } from '@/design-system/patterns';
import { VillageScenery } from './VillageScenery';
import { ServerBuildCard } from './ServerBuildCard';
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
type Door = Point & {
  r: Route;
  label: string;
  building?: Building;
  memberOnly?: boolean;
  visitorRoute?: Route;
  direct?: boolean;
  hitbox?: { x: number; y: number; w: number; h: number };
};
const legacyDoors: Record<string, Door> = {
  fire: {
    x: 460,
    y: 540,
    r: 'rest',
    label: '모닥불',
    memberOnly: true,
    // 낮 연기와 밤 불꽃이 그려지는 영역을 함께 덮는다.
    hitbox: { x: 402, y: 425, w: 143, h: 105 },
  },
  hall: { x: 1030, y: 268, r: 'hall', label: buildingNames.hall, building: 'hall' },
  board: { x: 891, y: 250, r: 'board', label: buildingNames.board, building: 'board' },
  gram: {
    x: 380,
    y: 485,
    r: 'sound',
    label: buildingNames.gram,
    building: 'gram',
    memberOnly: true,
  },
  library: {
    x: 1190,
    y: 612,
    r: 'library',
    label: buildingNames.library,
    building: 'library',
  },
  mail: { x: 320, y: 596, r: 'mail', label: buildingNames.mail, building: 'mail' },
  tower: { x: 272, y: 200, r: 'tower', label: buildingNames.tower, building: 'tower' },
  shop: { x: 577, y: 783, r: 'shop', label: buildingNames.shop, building: 'shop' },
  // 고양이는 부두 끝(x·y)까지 걸어가고, 탭 영역은 배경에 그려진 뗏목 위에 둔다. 기본 탭 영역은
  // 도착점 주변(부두의 육지 쪽 끝)이라 뗏목 그림을 눌러도 바다만 눌렀다(GROMO-2157).
  raft: {
    x: 274,
    y: 740,
    r: 'boat',
    label: '뗏목',
    memberOnly: true,
    hitbox: { x: 200, y: 815, w: 180, h: 110 },
  },
  fishingIsland: {
    x: 1345,
    y: 882,
    r: 'focusVisit',
    label: '낚시섬 구경하기',
    memberOnly: true,
    visitorRoute: 'visitIslandFocus',
    direct: true,
    hitbox: { x: 1230, y: 810, w: 230, h: 145 },
  },
};
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

const constructionPhaseLabels: Readonly<Record<ConstructionSpritePhase, string>> = {
  foundation: '기초 공사 중',
  structure: '골조 공사 중',
  finishing: '마감 공사 중',
  completion: '완공',
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
}: {
  color: Color;
  start: Point;
  s: number;
  reduce: boolean;
  delay: number;
  scene?: VillageScene;
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
      const path = (
        scene ? villagePath(scene, at.current, target) : landPath(grids.home, at.current, target)
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
  }, [scene, reduce]);
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
  children?:
    React.ReactNode | ((scale: number, project: (point: Point) => Point) => React.ReactNode);
}) {
  const L = useAppLayout(),
    grid: Grid = fishing ? grids.fishing : (village?.grid ?? grids.home),
    island = state.islands.find((item) => item.id === islandId) ?? homeIsland(state);
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
  const dist = (t: any[]) =>
    t.length > 1 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0;
  const midpoint = (t: any[]) => ({
    x: (t[0].pageX + t[1].pageX) / 2 - frame.current.x,
    y: (t[0].pageY + t[1].pageY) / 2 - frame.current.y,
  });
  const begin = (t: any[]) => {
    const v = current.current,
      c = v.camera;
    const m = t.length > 1 ? midpoint(t) : { x: v.width / 2, y: v.height / 2 };
    origin.current = {
      ...c,
      dist: dist(t),
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
        const t = touches(e),
          o = origin.current,
          v = current.current;
        if (t.length > 1) {
          if (!o.dist) {
            begin(t);
            return;
          }
          const z = Math.max(0.35, Math.min(2.6, (o.z * dist(t)) / o.dist)),
            m = midpoint(t);
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
          const p = {
            x: (rect ? event.clientX - rect.left : event.locationX) / scale,
            y: (rect ? event.clientY - rect.top : event.locationY) / scale,
          };
          if (onLand(grid, p)) current.current.onSpot?.(p);
        }}
      >
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
                  left,
                  top,
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
                left: left + 250 * scale,
                top: top + 456 * scale,
                width: 140 * scale,
                height: 140 * scale,
              }}
              resizeMode="contain"
            />
          )}
          {mailboxLetters && (
            <VillageNotificationBadge
              testID="mailbox-new-indicator"
              accessibilityLabel="친구에게 받은 새 편지가 있습니다"
              scale={scale}
              style={{ left: left + 348 * scale, top: top + 520 * scale }}
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
                left: left + 949 * scale,
                top: top + 21 * scale,
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
                left: left + 858 * scale,
                top: top + 158 * scale,
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
                left: left + 150 * scale,
                top: top + 24 * scale,
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
                left: left + 456 * scale,
                top: top + 580 * scale,
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
                left: left + 1120 * scale,
                top: top + 288 * scale,
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
                  left,
                  top,
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
  onReturnFromVisit,
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
  /** 서버 방문은 현재 소속 섬을 변경하지 않고 구경만 끝낸다. */
  onReturnFromVisit?: () => void;
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
  const scene = useMemo(
    () =>
      layeredPreview
        ? villageScene(
            sceneBuilding && !i.buildings.includes(sceneBuilding)
              ? [...i.buildings, sceneBuilding]
              : i.buildings,
          )
        : undefined,
    [layeredPreview, i.buildings, sceneBuilding],
  );
  const grid = scene?.grid ?? grids.home;
  // WorldMap 이 부모와 같은 낮·밤 값을 쓰도록 한 번만 계산해 내려준다.
  const dayNight = useVillageDayNight();
  const hasEntrySprite = (target: BuildingTransitionTarget | null) =>
    // 네 건물은 낮·밤 모두 진입 프레임이 있다.
    !scene &&
    (target === 'hall' || target === 'library' || target === 'shop' || target === 'tower');
  const fireObject = scene?.objects.find((object) => object.kind === 'fire');
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
    : legacyDoors;
  const positionKey = i.id + (layeredPreview ? ':layered' : ':original');
  const initial = () =>
    nearestLand(
      grid,
      homePositions[positionKey] ?? (layeredPreview ? { x: 820, y: 535 } : { x: 585, y: 470 }),
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
  const constructionObject = constructionBuilding
    ? constructionPlacement(constructionBuilding, layeredPreview)
    : undefined;
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
  const walk = (target: Point, done?: () => void) => {
    if (tiltTimer.current) clearTimeout(tiltTimer.current);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    setInteractiveMotion(null);
    const path = scene
      ? villagePath(scene, location.current, target)
      : landPath(grid, location.current, nearestLand(grid, target));
    const t = ++token.current;
    xy.stopAnimation();
    if (!path.length) {
      setWalking(false);
      return false;
    }
    if (path.length > 1) {
      setLeft(path[path.length - 1].x < location.current.x);
    }
    setWalking(true);
    let idx = 1;
    const next = () => {
      if (t !== token.current) return;
      if (idx >= path.length) {
        setWalking(false);
        if (pathDistance(path) >= 180) {
          triggerMotion('stretch');
        }
        done?.();
        return;
      }
      const p = path[idx++];
      if (Math.abs(p.x - location.current.x) > 0.5) {
        setLeft(p.x < location.current.x);
      }
      Animated.timing(xy, {
        toValue: p,
        duration: state.settings.reduceMotion ? 0 : 95,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          location.current = p;
          setPos(p);
          homePositions[positionKey] = p;
          next();
        }
      });
    };
    next();
    return true;
  };
  useEffect(() => {
    const p = initial();
    location.current = p;
    xy.setValue(p);
    setPos(p);
    setWalking(false);
    return () => {
      token.current++;
      xy.stopAnimation();
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
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={
                  id === 'mail' && mailboxLetters
                    ? '우체통, 친구에게 받은 새 편지가 있어요'
                    : d.building === 'board' && boardStatus === 'new-comment'
                      ? `${d.label}, 새 댓글이 있어요`
                      : d.building === 'board' && boardStatus === 'unread'
                        ? `${d.label}, 읽지 않은 새 소식이 있어요`
                        : d.building === 'shop' && shopState === 'new-product'
                          ? `${d.label}, 새 상품이 있어요`
                          : d.building === 'shop' && shopState === 'purchasable'
                            ? `${d.label}, 구매 가능한 상품이 있어요`
                            : d.building === 'tower' && observatoryRankState === 'rank-updated'
                              ? `${d.label}, 주간 순위가 갱신되었어요`
                              : d.building === 'tower' && observatoryRankState === 'rank-changed'
                                ? `${d.label}, 주간 순위가 바뀌었어요`
                                : d.building === 'library' && libraryState === 'new-quest'
                                  ? `${d.label}, 새 퀘스트가 있어요`
                                  : d.building === 'library' && libraryState === 'new-reading'
                                    ? `${d.label}, 새 읽을거리가 있어요`
                                    : d.label
                }
                // 토스트는 iOS 스크린리더가 읽지 않으므로 구경 중 주민 전용 건물은 미리 알려 준다
                accessibilityHint={
                  d.building === 'hall' && !visiting
                    ? '터치하면 마을 회관으로 들어가요'
                    : d.building === 'board' && !!boardStatus
                      ? '게시판을 열어 확인하세요'
                      : d.building === 'shop' && shopState !== 'normal'
                        ? '상점에서 상품을 확인하세요'
                        : d.building === 'tower' && observatoryRankState !== 'normal'
                          ? '전망대에서 주간 순위를 확인하세요'
                          : d.building === 'library' && libraryState !== 'normal'
                            ? '도서관에서 새 내용을 확인하세요'
                            : visiting && d.building && !['hall', 'board'].includes(d.building)
                              ? '주민만 이용할 수 있어요'
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
                  else if (d.building === 'gram') return;
                  else notify?.('주민만 이용할 수 있어요');
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
              />
            );
          })}
        {/* 주민 고양이 두 마리: 주민 색을 우선 쓰고, 모자라면 내 색과 다른 색으로 채운다 */}
        {wanderColors.map((color, n) => (
          <Wanderer
            key={color + n}
            color={color}
            start={nearestLand(grid, WANDER_STARTS[n])}
            scene={scene}
            s={s}
            reduce={state.settings.reduceMotion}
            delay={1200 + n * 2500}
          />
        ))}
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
              accessibilityLabel="내 고양이"
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
            action={{ title: '집중 시작', onPress: departFocus }}
          />
        )
      }
    >
      <WorldMap
        state={state}
        village={scene}
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
            accessibilityLabel={visiting ? undefined : `${i.name} 오늘 집중 ${todayClock}`}
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
                {`${i.name} 구경 중`}
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
                    오늘 집중
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
                  {buildingNames[i.construction?.building ?? next!]}{' '}
                  {i.construction ? '공사 중' : '짓기'}
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
                    ? `${Math.max(0, Math.ceil((i.construction.endsAt - Date.now()) / 60000))}분 남음`
                    : `${balance(i)}/${buildingCost(i, next!)} 마리`}
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
                <Btn small title="건설하기" style={{ marginTop: 2 }} onPress={() => build(next)} />
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
                title="원래 섬으로"
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
                <Btn round title="집중 시작" id="depart-focus" onPress={departFocus} />
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
export function FinalIsland(props: React.ComponentProps<typeof FinalIslandScene>) {
  const L = useAppLayout();
  const [layered, setLayered] = useState(
    () =>
      CAN_PREVIEW_VILLAGE &&
      ((Platform.OS === 'web' &&
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('village') === 'layered') ||
        process.env.EXPO_PUBLIC_VILLAGE_PREVIEW === '1'),
  );
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
        </View>
      )}
    </View>
  );
}
