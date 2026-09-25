import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { CatSprite, CatMotionInput, interactiveMotionDurationMs } from '@/components/CatSprite';
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
import { villageAssets } from '@/constants/village-assets';
import {
  villageScene,
  villagePath,
  villageDoors,
  villageMap,
  VillageScene,
} from '@/utils/village-world';
import { semanticTokens } from '@/design-system/tokens';
import { componentTokens } from '@/design-system/tokens';
import { getSession } from '@/services/api/session';
import { catColor } from '@/screens/focus/useIslandPresence';
import {
  BUILDING_ENTRY_DURATION_MS,
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
import { VillageNotificationBadge } from '@/components/village-motion/VillageNotificationBadge';

const pathDistance = (pts: readonly Point[]) => {
  let sum = 0;
  for (let idx = 1; idx < pts.length; idx++) {
    sum += Math.hypot(pts[idx].x - pts[idx - 1].x, pts[idx].y - pts[idx - 1].y);
  }
  return sum;
};
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
const legacyDoors: Record<string, Door> = {
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
  raft: { x: 274, y: 740, r: 'boat', label: '내 뗏목', memberOnly: true },
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
  children?:
    React.ReactNode | ((scale: number, project: (point: Point) => Point) => React.ReactNode);
}) {
  const L = useAppLayout(),
    grid: Grid = fishing ? grids.fishing : (village?.grid ?? grids.home),
    island = state.islands.find((item) => item.id === islandId) ?? homeIsland(state);
  const demoDay =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('demo') &&
    !new URLSearchParams(window.location.search).has('night');
  const [dayNight, setDayNight] = useState<'day' | 'night'>(() => {
    if (demoDay) return 'day';
    const hour = new Date().getHours();
    return hour >= 6 && hour < 18 ? 'day' : 'night';
  });
  useEffect(() => {
    if (demoDay) return;
    const updateLocalTime = () => {
      const hour = new Date().getHours();
      setDayNight(hour >= 6 && hour < 18 ? 'day' : 'night');
    };
    const timer = setInterval(updateLocalTime, 60_000);
    return () => clearInterval(timer);
  }, [demoDay]);
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
            .filter((b) => !(b === 'hall' && !village && !fishing && dayNight === 'day'))
            .filter((b) => !(b === 'board' && !village && !fishing && dayNight === 'day'))
            .filter((b) => !(b === 'tower' && !village && !fishing && dayNight === 'day'))
            .filter((b) => !(b === 'shop' && !village && !fishing && dayNight === 'day'))
            .filter((b) => !(b === 'library' && !village && !fishing && dayNight === 'day'))
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
            <VillageNotificationBadge
              testID="mailbox-new-indicator"
              accessibilityLabel="친구에게 받은 새 편지가 있습니다"
              scale={scale}
              style={{ left: left + 348 * scale, top: top + 520 * scale }}
            />
          )}
          {island.buildings.includes('hall') && dayNight === 'day' && (
            <VillageHallMotion
              testID="world-hall-motion"
              state={hallMotionActive ? 'arrival' : 'normal'}
              generation={hallMotionGeneration}
              style={{
                position: 'absolute',
                left: left + 950 * scale,
                top: top + 20 * scale,
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
              rankState={observatoryRankState}
              dayNight={dayNight}
              showFrames={dayNight === 'day'}
              generation={dayNight === 'day' && towerArrivalActive ? towerArrivalGeneration : 0}
              reduceMotion={state.settings.reduceMotion}
              style={{
                position: 'absolute',
                left: left + 152 * scale,
                top: top + 23 * scale,
                width: 112 * scale,
                height: 193 * scale,
              }}
            />
          )}
          {island.buildings.includes('shop') && (
            <ShopMotion
              testID="world-shop-motion"
              state={shopState}
              trigger={shopArrivalActive ? shopArrivalGeneration : 0}
              entryActive={shopArrivalActive}
              showFrames={dayNight === 'day'}
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
              state={libraryState}
              trigger={libraryArrivalActive ? libraryArrivalGeneration : 0}
              entryActive={libraryArrivalActive}
              showFrames={dayNight === 'day'}
              reduceMotion={state.settings.reduceMotion}
              style={{
                position: 'absolute',
                left: left + 1120 * scale,
                top: top + 289 * scale,
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
              left: left + 402 * scale,
              top: top + 425 * scale,
              width: 116 * scale,
              height: 77 * scale,
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
            .filter((b) => island.buildingThemes?.[b] && island.buildingThemes?.[b] !== 'default')
            .map((b) => (
              <Image
                key={b}
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
          />
        )}
        {typeof children === 'function'
          ? (children as (scale: number, project: (point: Point) => Point) => React.ReactNode)(
              scale,
              (point) => ({ x: left + point.x * scale, y: top + point.y * scale }),
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
  motion,
  boardStatus = null,
  observatoryRankState = 'normal',
  shopState = 'normal',
  libraryState = 'normal',
  onBuildingEntrySound,
  layeredPreview = false,
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
  motion?: CatMotionInput;
  boardStatus?: 'unread' | 'new-comment' | null;
  observatoryRankState?: ObservatoryRankState;
  shopState?: ShopMotionState;
  libraryState?: LibraryMotionState;
  /** 문 소스 확보 전까지는 선택적 연결 계약으로 두고 소리가 꺼져 있으면 호출하지 않는다. */
  onBuildingEntrySound?: (target: BuildingTransitionTarget, generation: number) => void;
  layeredPreview?: boolean;
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
    L = useAppLayout();
  const scene = useMemo(
    () => (layeredPreview ? villageScene(i.buildings) : undefined),
    [layeredPreview, i.buildings],
  );
  const grid = scene?.grid ?? grids.home;
  const doors: Record<string, Door> = scene
    ? Object.fromEntries(
        Object.entries(legacyDoors).map(([id, door]) => [
          id,
          id === 'raft'
            ? {
                ...door,
                x: villageMap.crossings.dock.arrival[0],
                y: villageMap.crossings.dock.arrival[1],
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
              if (d.building == null) return { left: 0, top: 0, alignItems: 'flex-start' as const };
              if (scene) {
                return labelOnRight
                  ? { right: 0, top: -30, alignItems: 'flex-end' as const }
                  : { left: 0, top: -30, alignItems: 'flex-start' as const };
              }
              const box = legacyBuildingLabelBox[d.building];
              return labelOnRight
                ? {
                    right: (hitbox.x + hitbox.w - (box.x + box.w)) * s,
                    top: (box.y - hitbox.y) * s - 30,
                    alignItems: 'flex-end' as const,
                  }
                : {
                    left: (box.x - hitbox.x) * s,
                    top: (box.y - hitbox.y) * s - 30,
                    alignItems: 'flex-start' as const,
                  };
            })();
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={
                  id === 'mail' && !visiting && hasMailboxLetters(state, i.id)
                    ? '우체통, 친구에게 받은 새 편지가 있어요'
                    : d.building === 'board' && boardStatus === 'new-comment'
                      ? `${d.label}, 새 댓글이 있어요`
                      : d.building === 'board' && boardStatus === 'unread'
                        ? `${d.label}, 읽지 않은 새 소식이 있어요`
                        : d.building === 'shop' && shopState === 'new-product'
                          ? `${d.label}, 새 상품이 있어요`
                          : d.building === 'shop' && shopState === 'purchasable'
                            ? `${d.label}, 구매 가능한 상품이 있어요`
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
                        BUILDING_ENTRY_DURATION_MS,
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
              >
                {d.building && (
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
                        minHeight: 24,
                        justifyContent: 'center',
                        paddingHorizontal: 8,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: semanticTokens.color.outline,
                        backgroundColor: semanticTokens.color.surface,
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
  const today = facts ? facts.home.focusSummary.totalSeconds : todayFocusSeconds(state, i.id),
    todayClock = [Math.floor(today / 3600), Math.floor(today / 60) % 60, Math.floor(today) % 60]
      .map((v) => String(v).padStart(2, '0'))
      .join(':');
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
  return (
    <View style={{ flex: 1 }}>
      <WorldMap
        state={state}
        village={scene}
        islandId={i.id}
        hallMotionActive={
          buildingTransition.phase === 'entering' && buildingTransition.target === 'hall'
        }
        hallMotionGeneration={buildingTransition.generation}
        boardStatus={boardStatus}
        observatoryRankState={observatoryRankState}
        shopState={shopState}
        libraryState={libraryState}
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
        showMailboxLetters={!visiting && hasMailboxLetters(state, i.id)}
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
          {/* 서버 건설은 회관의 서버 경로 몫이다 — 로컬 비용·BUILD 카드는 목업에서만 띄운다 */}
          {!visiting && !facts && (i.construction || next) && (
            <View
              style={{
                position: 'absolute',
                left: L.landscape ? Math.max(56, L.insets.left + 4) : 20,
                width: L.landscape ? 300 : L.width * 0.52,
                bottom: L.landscape ? 24 : Math.max(52, L.insets.bottom + 18),
                backgroundColor: '#FFFDFAF2',
                borderColor: '#8B6956',
                borderWidth: 1.5,
                borderRadius: 18,
                paddingVertical: 12,
                paddingHorizontal: 14,
                gap: 8,
              }}
            >
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
                  // 구경을 끝내고 내 섬으로 배를 타고 돌아간다. Travel 도착 시 SWITCH_ISLAND 후 홈
                  dispatch?.({ type: 'TRAVEL_FROM', name: i.name });
                  dispatch?.({ type: 'END_VISIT' });
                  go('travel', currentIsland(state).id);
                }}
              />
            ) : (
              <Btn
                round
                title="집중하기"
                id="depart-focus"
                onPress={() => {
                  if (!buildingEntryPending.current) walk(doors.raft, () => go('focusTravel'));
                }}
              />
            )}
          </View>
        </>
      )}
      <BuildingTransitionOverlay
        state={buildingTransition}
        reduceMotion={state.settings.reduceMotion}
        origin={transitionOrigin}
        delayMs={buildingTransition.direction === 'enter' ? BUILDING_SPRITE_LEAD_IN_MS : 0}
      />
    </View>
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
