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
  Route,
  Building,
  Color,
  currentIsland,
  viewIsland,
  buildingNames,
  balance,
  isHost,
  buildingCost,
  sessionSeconds,
  buildMinutes,
  dayKey,
  kstDayStart,
  recordSecondsBetween,
} from '@/services/model';
import { assets, cat } from '@/constants/assets';
import { CatSprite } from '@/components/CatSprite';
import {
  claimableQuestRewardCount,
  HOME_QUEST_LIST_DETAIL,
  HomeQuestIndicator,
} from '@/screens/island/HomeQuestIndicator';
import { useAppLayout } from '@/utils/layout';
import { Grid, Point, onLand, nearestLand, landPath } from '@/utils/world-grid';
import grids from '@/constants/world-v2.json';
import { Btn, C, Txt, Pic } from '@/design-system/patterns';
import { componentTokens } from '@/design-system/tokens';
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
const doors: Record<string, Door> = {
  hall: { x: 1030, y: 268, r: 'hall', label: buildingNames.hall, building: 'hall' },
  board: { x: 891, y: 250, r: 'board', label: buildingNames.board, building: 'board' },
  gram: { x: 380, y: 485, r: 'sound', label: buildingNames.gram, building: 'gram' },
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
}: {
  color: Color;
  start: Point;
  s: number;
  reduce: boolean;
  delay: number;
}) {
  const xy = useRef(new Animated.ValueXY(start)).current,
    at = useRef(start);
  const [walking, setWalking] = useState(false),
    [left, setLeft] = useState(false);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const roam = () => {
      if (!alive) return;
      // 지금 자리에서 ±200·±150px 안의 땅 한 곳으로, 최대 14칸까지만 걷는다
      const target = nearestLand(grids.home, {
        x: at.current.x + Math.random() * 400 - 200,
        y: at.current.y + Math.random() * 300 - 150,
      });
      const path = landPath(grids.home, at.current, target).slice(1, 15);
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
  }, []);
  return (
    <Animated.View
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
export function WorldMap({
  state,
  islandId,
  fishing = false,
  onSpot,
  emote,
  children,
}: {
  state: State;
  islandId?: string;
  fishing?: boolean;
  onSpot?: (p: Point) => void;
  emote?: string | null;
  children?: React.ReactNode | ((scale: number) => React.ReactNode);
}) {
  const L = useAppLayout(),
    grid: Grid = fishing ? grids.fishing : grids.home,
    island = state.islands.find((item) => item.id === islandId) ?? viewIsland(state);
  const [camera, setCamera] = useState({
    x: fishing ? 512 : 585,
    y: fishing ? 770 : 430,
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
                href={assets['backgrounds/island/base/day.png']}
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
              : assets['backgrounds/island/base/day.png']
          }
          style={{ width: '100%', height: '100%' }}
          resizeMode="stretch"
        />
      </Pressable>
      {!fishing && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {island.buildings.map((b) => (
            <Image
              key={b}
              source={assets[`backgrounds/island/layers/day/${layer[b]}.png`]}
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
      {!fishing && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {island.buildings
            .filter((b) => island.buildingThemes?.[b] && island.buildingThemes?.[b] !== 'default')
            .map((b) => (
              <Image
                key={b}
                source={assets[`backgrounds/island/layers/day/${layer[b]}.png`]}
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
        {typeof children === 'function' ? (children as any)(scale) : children}
      </View>
    </View>
  );
}
export function FinalIsland({
  state,
  go,
  build,
  showHud = true,
  showActions = true,
  request,
  notify,
  dispatch,
  viewingIslandId,
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
}) {
  // 구경 중이면 구경하는 섬을 그리고, 내 고양이·집중·건설 없이 둘러보기만 한다.
  // viewingIslandId는 방문 카드에서 들어온 읽기 전용 경로라 전역 소속/방문 상태를 바꾸지 않는다.
  const explicitVisit = !!viewingIslandId,
    i = state.islands.find((island) => island.id === viewingIslandId) ?? viewIsland(state),
    visiting = explicitVisit || !!state.visitingIslandId,
    L = useAppLayout();
  const [pos, setPos] = useState(homePositions[i.id] ?? { x: 585, y: 470 }),
    [walking, setWalking] = useState(false);
  const xy = useRef(new Animated.ValueXY(pos)).current,
    token = useRef(0),
    location = useRef(pos);
  const walk = (target: Point, done?: () => void) => {
    const path = landPath(grids.home, location.current, nearestLand(grids.home, target));
    const t = ++token.current;
    xy.stopAnimation();
    if (!path.length) return;
    setWalking(true);
    let idx = 1;
    const next = () => {
      if (t !== token.current) return;
      if (idx >= path.length) {
        setWalking(false);
        done?.();
        return;
      }
      const p = path[idx++];
      Animated.timing(xy, {
        toValue: p,
        duration: state.settings.reduceMotion ? 0 : 95,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          location.current = p;
          setPos(p);
          homePositions[i.id] = p;
          next();
        }
      });
    };
    next();
  };
  useEffect(() => {
    const p = homePositions[i.id] ?? { x: 585, y: 470 };
    location.current = p;
    xy.setValue(p);
    setPos(p);
    return () => {
      token.current++;
      xy.stopAnimation();
    };
  }, [i.id]);
  useEffect(() => {
    if (request && !visiting) {
      const d = Object.values(doors).find((d) => d.r === request);
      if (d) {
        if (d.direct) go(request);
        else walk(d, () => go(request));
      }
    }
  }, [request]);

  const wanderColors = useMemo(() => {
    const others = i.members.filter((m) => m.id !== 'me').map((m) => m.color as Color);
    const spare = (['white', 'gray', 'ginger', 'calico', 'cream', 'black'] as Color[]).filter(
      (c) => c !== state.color && !others.includes(c),
    );
    return [...others, ...spare].slice(0, 2);
  }, [i.members, state.color]);
  // Child positions scale with the camera, rather than being pasted onto a cropped image.
  const actors = (s: number) => {
    return (
      <>
        {Object.entries(doors)
          // 방문 카드에서 연 읽기 전용 화면은 낚시섬 관전만 연다. 기존 방문자 홈은 회관·게시판도 열 수 있다.
          .filter(([, d]) =>
            explicitVisit
              ? !!d.visitorRoute
              : d.memberOnly
                ? !visiting || !!d.visitorRoute
                : !!d.building && i.buildings.includes(d.building),
          )
          .map(([id, d]) => {
            const hitbox = d.hitbox ?? { x: d.x - 60, y: d.y - 95, w: 120, h: 125 };
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={d.label}
                // 토스트는 iOS 스크린리더가 읽지 않으므로 구경 중 주민 전용 건물은 미리 알려 준다
                accessibilityHint={
                  visiting && d.building && !['hall', 'board'].includes(d.building)
                    ? '주민만 이용할 수 있어요'
                    : undefined
                }
                onPress={() => {
                  if (!visiting) return d.direct ? go(d.r) : walk(d, () => go(d.r));
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
                }}
              />
            );
          })}
        {/* 주민 고양이 두 마리: 주민 색을 우선 쓰고, 모자라면 내 색과 다른 색으로 채운다 */}
        {wanderColors.map((color, n) => (
          <Wanderer
            key={color + n}
            color={color}
            start={nearestLand(grids.home, WANDER_STARTS[n])}
            s={s}
            reduce={state.settings.reduceMotion}
            delay={1200 + n * 2500}
          />
        ))}
        {/* 구경 중에는 내 고양이가 이 섬에 없다 */}
        {!visiting && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: Animated.multiply(xy.x, s),
              top: Animated.multiply(xy.y, s),
            }}
          >
            {/* v2 홈 시안은 고양이 100px(섬 원본 좌표)인데 카메라를 당기면서 70px 로 줄임 · 이름표 없음 */}
            <CatSprite
              color={state.color}
              size={70 * s}
              motion={walking ? 'walking' : 'blink'}
              reduce={state.settings.reduceMotion}
            />
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
  const todayFrom = kstDayStart(dayKey()),
    todayUntil = todayFrom + 86400000,
    today = state.records
      .filter((record) => record.islandId === i.id)
      .reduce(
        (seconds, record) => seconds + recordSecondsBetween(record, todayFrom, todayUntil),
        0,
      );
  const hudTop = L.landscape ? 14 : Math.max(64, L.insets.top + 5),
    hudLeft = L.landscape ? Math.max(56, L.insets.left + 4) : 20,
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
        islandId={i.id}
        onSpot={visiting ? undefined : (p) => walk(p)}
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
            style={{
              backgroundColor: '#FFFDFAB3',
              borderRadius: 999,
              paddingVertical: 6,
              paddingLeft: 14,
              paddingRight: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              minWidth: visiting ? undefined : 210,
            }}
          >
            {/* 구경 중에는 내 집중 시간 대신 어느 섬을 구경하는지만 작게 보여준다 */}
            {visiting ? (
              <Txt kind="meta" style={{ fontSize: 13, lineHeight: 18.85, fontWeight: '600' }}>
                {`${i.name} 구경 중`}
              </Txt>
            ) : (
              <>
                <Txt kind="meta" style={{ fontSize: 12, lineHeight: 17.4, fontWeight: '600' }}>
                  오늘 집중
                </Txt>
                <Txt
                  style={{
                    fontSize: 22,
                    lineHeight: 31.9,
                    fontWeight: '700',
                    fontVariant: ['tabular-nums'],
                    marginLeft: 'auto',
                  }}
                >
                  {[Math.floor(today / 3600), Math.floor(today / 60) % 60, Math.floor(today) % 60]
                    .map((v) => String(v).padStart(2, '0'))
                    .join(':')}
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
          {!visiting && (i.construction || next) && (
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
                onPress={() => walk(doors.raft, () => go('focusTravel'))}
              />
            )}
          </View>
        </>
      )}
    </View>
  );
}
