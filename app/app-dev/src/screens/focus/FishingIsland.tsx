import React, { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Ellipse, Image as SvgImage, Path, Pattern, Rect } from 'react-native-svg';
import { Text } from '@/design-system/typography';
import { assets, cat } from '@/constants/assets';
import { art } from '@/constants/art';
import { C } from '@/design-system/primitives';
import { CatSprite } from '@/components/CatSprite';
import { Color, SECONDS_PER_FISH } from '@/services/model';
import { Grid, Point, nearestLand } from '@/utils/world-grid';
import { useAppLayout } from '@/utils/layout';
import land from '@/constants/fishing-island.json';

// v2 시안 낚시섬(focus-island-flow): 좌표는 지도 가로·세로 % (0~100). 지도는 섬 그림(1536×1024) 비율 그대로.
// 땅 격자는 시안 land_mask 와 같은 50×50 칸(파란 칸 = 물).
export const fishingGrid: Grid = land;
export const INK = '#493B39',
  OUTLINE = '#8B6956',
  ME = '#B83D63';
// 도착 지점 바다 위 뗏목 한 대. 고양이는 뗏목 바로 위쪽의 가장 가까운 땅에 내려 선다.
export const RAFT = { x: 37.8, y: 91.8 };
export const LANDING = nearestLand(fishingGrid, { x: RAFT.x, y: RAFT.y - 6 });
// 우리 섬에 축음기를 지었으면 낚시섬에도 한 대(지도 폭 6% · 시안 CSS 17:03). 낚시 자리·뗏목·올라오는 길을 피한 남동쪽 풀밭.
export const GRAM = { x: 50, y: 70, w: 6 };
const gramBox = { x: 12, y: 12, w: 608, h: 886 }; // buildings/gramophone/day.png(632×910) 의 그림 영역
export type Spot = { x: number; y: number; face: number; bx?: number; by?: number };
// 누른 곳에 앉히고 12% 안에서 가장 가까운 물 쪽으로 낚싯줄을 던진다. 물이 멀면 줄 없이 앉는다.
// 좌표는 반올림하지 않는다(물가 칸 경계에서 반올림하면 물 칸이 될 수 있음).
export function castSpot({ x, y }: Point): Spot {
  let best: Point | null = null,
    d = 144;
  for (let c = 0; c < fishingGrid.cells.length; c++) {
    if (fishingGrid.cells[c] === '1') continue;
    const wx = ((c % 50) + 0.5) * 2,
      wy = (Math.floor(c / 50) + 0.5) * 2,
      dd = (wx - x) ** 2 + (wy - y) ** 2;
    if (dd < d) {
      d = dd;
      best = { x: wx, y: wy };
    }
  }
  return best ? { x, y, face: best.x < x ? -1 : 1, bx: best.x, by: best.y } : { x, y, face: 1 };
}
// 지도 % 좌표 사이 거리(세로 %는 지도 비율 1024/1536으로 맞춰 지도 폭 % 단위로 잰다)
const apart = (p: Point, q: Point) => Math.hypot(q.x - p.x, ((q.y - p.y) * 1024) / 1536);
// 스크린리더로 자리를 고를 때 앉는 기본 빈 자리(시안 예시 내 자리)
export const DEFAULT_SPOT = { x: 34.1, y: 55.9 };
// 낚시 중인 주민 자리(정원 15명 = 나 + 주민 14명). 앞 두 자리는 시안 예시 좌표, 다음 다섯은 땅 위 예시 자리.
// 나머지는 섬 가운데에 가까운 땅 칸부터 훑어, 이미 정한 자리·축음기·뗏목 내리는 곳·기본 내 자리와 지도 폭 11% 넘게
// 떨어지고 12% 안에 물이 있는(낚싯줄을 던질 수 있는) 곳을 차례로 더한다. 모두 땅 위이고 서로 겹치지 않는다.
export const PEER_SPOTS: Spot[] = (() => {
  const spots: Point[] = [
      { x: 18.5, y: 39.5 },
      { x: 60.2, y: 44.1 },
      { x: 45, y: 25 },
      { x: 70, y: 30 },
      { x: 80, y: 62 },
      { x: 75, y: 45 },
      { x: 40, y: 70 },
    ],
    avoid = [GRAM, LANDING, DEFAULT_SPOT],
    { cols, cells } = fishingGrid,
    land = (c: number) => cells[c] === '1',
    candidates: Point[] = [];
  for (let c = 0; c < cells.length; c++) {
    const col = c % cols,
      row = Math.floor(c / cols);
    // 네 이웃도 땅인 칸(물가 끝에 걸치지 않게)
    if (
      col &&
      row &&
      col < cols - 1 &&
      row < cols - 1 &&
      [c, c - 1, c + 1, c - cols, c + cols].every(land)
    )
      candidates.push({ x: (col + 0.5) * 2, y: (row + 0.5) * 2 });
  }
  candidates.sort((a, b) => apart(a, { x: 50, y: 50 }) - apart(b, { x: 50, y: 50 }));
  for (const p of candidates) {
    if (spots.length >= 14) break;
    if ([...spots, ...avoid].every((q) => apart(p, q) >= 11) && castSpot(p).bx != null)
      spots.push(p);
  }
  // 시안 예시 두 자리는 낚싯줄 끝도 시안 좌표 그대로. 여섯째 자리(축음기 앞)는 새로 뽑은 첫 자리로 채운다
  const cast = spots.map(castSpot);
  cast[0] = { x: 18.5, y: 39.5, face: 1, bx: 19.5, by: 38.7 };
  cast[1] = { x: 60.2, y: 44.1, face: -1, bx: 59.1, by: 44.9 };
  return [...cast.slice(0, 5), cast[7], ...cast.slice(5, 7), ...cast.slice(8)];
})();
// 다른 주민 자리와 가까운지(지도 폭 5% 안)
export const occupied = (p: Point, spots: Point[]) => spots.some((q) => apart(p, q) < 5);
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
export function fishingCamera(w: number, h: number, zoom: number, focus: Point, ratio = 0.5) {
  const size = (w >= 600 ? w : 640) * zoom,
    sizeY = (size * 1024) / 1536,
    offTop = Math.max(0, (h - sizeY) / 2),
    // 스크롤 위치는 브라우저처럼 정수 픽셀(지도 크기·위치도 정수로 반올림해 계산)
    // 0.8배로 줄여 지도가 화면보다 좁으면(가로·태블릿) 가로 가운데에 둔다
    sx =
      size < w
        ? Math.round((size - w) / 2)
        : Math.round(Math.max(0, Math.min(size - w, (Math.round(size) * focus.x) / 100 - w / 2))),
    sy = Math.round(
      Math.max(
        0,
        Math.min(sizeY - h, Math.round(offTop) + (Math.round(sizeY) * focus.y) / 100 - h * ratio),
      ),
    );
  return { size, sizeY, offTop, sx, sy, left: -sx, top: offTop - sy };
}
// 집중 준비 카드 위치: 내 고양이(x, y 발 기준, 고양이 크기 a) 위 → 아래 → 오른쪽 → 왼쪽 중 화면(W×H, 위 여백 T) 안에 들어가는 첫 자리.
// 어디에도 안 들어가면(가로 화면에 키보드가 떠 H가 작을 때) 버튼이 보이게 카드 아래를 화면 안에 맞추고 위로 올린다.
export function anchorCard(
  x: number,
  y: number,
  a: number,
  dw: number,
  dh: number,
  W: number,
  H: number,
) {
  const T = W > H ? 12 : 60,
    hx = Math.max(8, Math.min(W - dw - 8, x - dw / 2)),
    vy = Math.min(H - dh - 8, Math.max(T, y - a / 2 - dh / 2));
  const [top, left] = [
    [y - a - 10 - dh, hx],
    [y + 26, hx],
    [vy, x + a / 2 + 12],
    [vy, x - a / 2 - 12 - dw],
  ].find(([t, l]) => t >= T && t + dh <= H - 8 && l >= 8 && l + dw <= W - 8) ?? [vy, hx];
  return { top, left };
}
const raftBox = { x: 48, y: 307, w: 928, h: 669 }; // boats/raft/day.png 의 그림 영역
// 화면보다 큰 지도·배경을 자르는 컨테이너. 웹의 hidden 은 포커스·scrollIntoView 로 속이 밀릴 수 있어 clip 을 쓴다.
export const clip = (Platform.OS === 'web' ? 'clip' : 'hidden') as 'hidden';
export function FishingIsland({
  focus,
  ratio = 0.5,
  spots,
  onTap,
  onRaft,
  gram = false,
  onGram,
  seated = false,
  inert = false,
  children,
  overlay,
}: {
  focus: Point;
  ratio?: number;
  spots: Spot[];
  onTap?: (p: Point) => void;
  onRaft: () => void;
  // 축음기(우리 섬에 지었을 때만 보임). onGram 이 없으면 그림만(누를 수 없음), 누르면 음악 고르기만 열리고 고양이는 걷지 않는다
  gram?: boolean;
  onGram?: () => void;
  // 모달이 떠 있으면 지도를 스크린리더에서 숨긴다
  inert?: boolean;
  // 내 자리가 있으면 1.4배 이상 확대할 때 내 자리를 가운데로
  seated?: boolean;
  children: (size: number, sizeY: number, zoom: number) => React.ReactNode;
  overlay?: (toScreen: (p: Point) => Point, size: number) => React.ReactNode;
}) {
  const L = useAppLayout();
  const [cam, setCam] = useState({ zoom: 1, x: focus.x, y: focus.y });
  // 상태가 바뀌면(도착·준비·집중·결과) 다시 내 자리를 보여 준다. 확대 배율은 유지.
  useEffect(() => setCam((c) => ({ ...c, x: focus.x, y: focus.y })), [focus.x, focus.y, ratio]);
  const view = fishingCamera(L.width, L.height, cam.zoom, cam, ratio);
  const live = useRef({ cam, L, ratio, focus, seated, overlay });
  live.current = { cam, L, ratio, focus, seated, overlay };
  // 끌기 기준점. 손가락 수가 바뀌면(핀치 → 한 손가락) 지금 위치에서 다시 잡아 지도가 튀지 않게 한다
  const start = useRef({ zoom: 1, x: 0, y: 0, dist: 0, n: 0, dx: 0, dy: 0 }),
    dragged = useRef(false),
    node = useRef<View>(null);
  // 확대·축소 0.8~1.8배: 보던 곳을 유지하고, 1.4배부터는 내 자리를 가운데로
  const zoomTo = (z: (c: typeof cam) => number) =>
    setCam((c) => {
      const zoom = Math.max(0.8, Math.min(1.8, z(c))),
        { focus: f, seated: me } = live.current;
      return zoom >= 1.4 && me ? { zoom, x: f.x, y: f.y } : { ...c, zoom };
    });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // 집중 준비 카드가 떠 있으면 지도를 끌지 않는다
      onMoveShouldSetPanResponder: (e, g) =>
        !live.current.overlay &&
        ((e.nativeEvent.touches?.length ?? 0) > 1 || Math.abs(g.dx) + Math.abs(g.dy) > 6),
      onPanResponderGrant: () => {
        start.current.n = 0;
        dragged.current = true;
      },
      onPanResponderMove: (e, g) => {
        const n = Math.max(1, e.nativeEvent.touches?.length ?? 1),
          t = e.nativeEvent.touches ?? [],
          s = start.current,
          { cam: c, L: l, ratio: r } = live.current,
          v = fishingCamera(l.width, l.height, c.zoom, c, r);
        if (n !== s.n) {
          start.current = { zoom: c.zoom, x: v.sx, y: v.sy, dist: 0, n, dx: g.dx, dy: g.dy };
          return;
        }
        if (n > 1) {
          const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
          if (!s.dist) s.dist = d;
          else zoomTo(() => (s.zoom * d) / s.dist);
          return;
        }
        // 끌어서 둘러보기: 스크롤 위치를 제한한 뒤 보는 곳으로 되돌려 저장한다(끝에 걸린 채 더 끌어도 밀리지 않게).
        // 화면보다 좁은 방향은 가운데 고정이라 움직이지 않는다.
        const sx = Math.max(0, Math.min(v.size - l.width, s.x - (g.dx - s.dx))),
          sy = Math.max(0, Math.min(v.sizeY - l.height, s.y - (g.dy - s.dy)));
        setCam({
          zoom: c.zoom,
          x: v.size > l.width ? ((sx + l.width / 2) / v.size) * 100 : c.x,
          y: v.sizeY > l.height ? ((sy - v.offTop + l.height * r) / v.sizeY) * 100 : c.y,
        });
      },
      onPanResponderRelease: () => {
        setTimeout(() => (dragged.current = false), 80);
      },
      onPanResponderTerminate: () => {
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
      zoomTo((c) => c.zoom * Math.exp(-e.deltaY / 200));
    };
    el?.addEventListener?.('wheel', wheel, { passive: false });
    return () => el?.removeEventListener?.('wheel', wheel);
  }, []);
  const { size, sizeY, left, top } = view,
    tile = (L.width >= 600 ? L.width * 0.319 : 204) * cam.zoom,
    raftW = size * 0.12,
    gramW = (size * GRAM.w) / 100,
    raftK = raftW / raftBox.w;
  return (
    <View
      ref={node}
      testID="fishing-world"
      {...pan.panHandlers}
      style={{ flex: 1, backgroundColor: '#74B9B9', overflow: clip }}
    >
      {/* 지도 밖은 섬 그림 귀퉁이 바다를 뒤집어 이은 무늬 */}
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern
            id="fishing-sea"
            x={-view.sx}
            y={-view.sy}
            width={tile}
            height={tile}
            patternUnits="userSpaceOnUse"
          >
            <SvgImage
              href={require('@/assets/backgrounds/fishing-island/sea-tile.jpg')}
              width={tile}
              height={tile}
              preserveAspectRatio="none"
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#fishing-sea)" />
      </Svg>
      <View
        style={{ position: 'absolute', left, top, width: size, height: sizeY }}
        {...a11yHidden(inert || !!overlay)}
      >
        <Pressable
          // 스크린리더 사용자는 좌표를 누를 수 없으니 "빈 자리에 앉기" 동작으로 기본 빈 자리를 고른다
          accessible={!!onTap}
          accessibilityRole={onTap ? 'button' : undefined}
          accessibilityLabel={onTap ? '낚시섬 땅 · 원하는 곳을 눌러 앉기' : undefined}
          accessibilityActions={onTap ? [{ name: 'activate', label: '빈 자리에 앉기' }] : undefined}
          onAccessibilityAction={() => onTap?.(DEFAULT_SPOT)}
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
            source={require('@/assets/backgrounds/fishing-island/day.jpg')}
            style={{ width: '100%', height: '100%' }}
            resizeMode="stretch"
          />
        </Pressable>
        <Svg
          pointerEvents="none"
          width={size}
          height={sizeY}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: 'absolute', zIndex: 3 }}
        >
          {spots
            .filter((s) => s.bx != null)
            .map((s, n) => (
              <React.Fragment key={n}>
                <Path
                  d={`M ${s.x + s.face * 3.6} ${s.y - 4.8} Q ${s.bx} ${s.y - 4.8} ${s.bx} ${s.by}`}
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
              </React.Fragment>
            ))}
        </Svg>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뗏목 · 우리 섬으로 돌아가기"
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
            accessibilityLabel={onGram ? '축음기 · 음악 고르기' : undefined}
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
        {children(size, sizeY, cam.zoom)}
      </View>
      {overlay?.((p) => ({ x: left + (size * p.x) / 100, y: top + (sizeY * p.y) / 100 }), size)}
    </View>
  );
}
// 머리 위 과목·시간표 상자(지도 px). 글자 폭은 대략값: 10px 한글 한 자 ≈ 10px, 시간 8자 ≈ 50px, 최대 120px
export function labelBox(spot: Spot, subject: string, size: number, sizeY: number) {
  const a = size * 0.077,
    w = Math.min(120, 16 + Math.max(50, [...subject].length * 10)),
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
const nameText = (me: boolean) => ({
  fontSize: 11,
  lineHeight: 17.6,
  fontWeight: '900' as const,
  color: me ? ME : INK,
  textShadowColor: '#FFFDFA',
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 5,
});
// 낚시하는 고양이(fi-actor): 지도 폭 7.7% · 발 기준점(256,464)/512 · 머리 위 과목·시간표(이모티콘은 그 위에 3초 겹침) · 아래 이름.
// 집중 화면에는 잡은 수를 숫자로 보이지 않는다(더미 그림만: 1마리부터 한 마리, 8마리부터 작은 더미, 24마리부터 큰 더미).
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
}) {
  const [frame, setFrame] = useState(0),
    [reeling, setReeling] = useState(false);
  const count = Math.floor(seconds / SECONDS_PER_FISH),
    last = useRef(count);
  // 새로 한 마리 잡으면 2초 동안 낚아올리기
  useEffect(() => {
    const caught = count > last.current;
    last.current = count;
    if (!caught || reduce) return;
    setReeling(true);
    const t = setTimeout(() => setReeling(false), 2000);
    return () => clearTimeout(t);
  }, [count, reduce]);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % 4), 450);
    return () => clearInterval(t);
  }, [reduce]);
  const a = size * 0.077,
    face = spot.face;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (size * spot.x) / 100 - a / 2,
        top: (sizeY * spot.y) / 100 - a * 0.90625,
        width: a,
        height: a,
        zIndex: 20 + Math.round(spot.y),
      }}
    >
      <Image
        source={cat(color, `fishing/${reeling ? 'reel' : 'fishing'}-frame-${frame}`)}
        style={{ position: 'absolute', width: a, height: a, transform: [{ scaleX: face }] }}
        resizeMode="contain"
      />
      <Image
        source={assets['props/fishing/fishing-rod.png']}
        resizeMode="contain"
        style={{
          position: 'absolute',
          width: a * 0.6,
          height: a * 0.6,
          left: face < 0 ? -a * 0.25 : a * 0.65,
          top: a * 0.1,
          transform: [{ scaleX: face }],
          transformOrigin: '20% 85%',
        }}
      />
      <View
        style={{ position: 'absolute', bottom: a * 1.05, left: a / 2 - 100, width: 200 }}
        pointerEvents="none"
      >
        {subject != null && (
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
        )}
        {emote && (
          <View
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}
          >
            <View
              style={{
                backgroundColor: '#FFFDFA',
                borderWidth: 2,
                borderColor: OUTLINE,
                borderRadius: 15,
                paddingVertical: 4,
                paddingHorizontal: 8,
              }}
            >
              <Image source={art[`emote/${emote}`]} style={{ width: 30, height: 30 }} />
            </View>
          </View>
        )}
      </View>
      <View style={{ position: 'absolute', top: a * 0.98, left: a / 2 - 100, width: 200 }}>
        <Text style={[nameText(me), { textAlign: 'center' }]}>{name}</Text>
      </View>
      {count > 0 && (
        <Image
          source={
            assets[
              `props/fishing/catch/${count >= 24 ? 'pile-large' : count >= 8 ? 'pile-small' : 'single'}.png`
            ]
          }
          resizeMode="contain"
          style={{
            position: 'absolute',
            left: -a * 0.58,
            bottom: -a * 0.09,
            width: a * 0.6,
            height: a * 0.6,
          }}
        />
      )}
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
}: {
  p: Point;
  size: number;
  sizeY: number;
  color: Color;
  walking: boolean;
  left: boolean;
  reduce: boolean;
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
        motion={walking ? 'walking' : 'blink'}
        left={left}
        reduce={reduce}
      />
      <View style={{ position: 'absolute', top: a * (0.98 - 0.90625), left: -100, width: 200 }}>
        <Text style={[nameText(true), { textAlign: 'center' }]}>나</Text>
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
}: {
  title: string;
  onPress: () => void;
  id?: string;
  primary?: boolean;
  small?: boolean;
  left?: boolean;
  bg?: string;
  style?: any;
}) {
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingVertical: small ? 8 : 10,
          paddingHorizontal: small ? 11 : 15,
          borderRadius: 999,
          borderWidth: 2,
          borderColor: OUTLINE,
          backgroundColor: bg ?? (primary ? C.pink : C.cream),
          boxShadow: `0px ${pressed ? 1 : 4}px 0px ${OUTLINE}`,
          transform: [{ translateY: pressed ? 3 : 0 }],
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize: small ? 11 : 14,
          lineHeight: small ? 14.3 : 18.2,
          fontWeight: '900',
          color: INK,
          textAlign: left ? 'left' : 'center',
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
// 낚시섬 모달(fi-modal): 반투명 막 위 가운데 카드. 가로(폭 600 이상)는 오른쪽 330px.
export function FiModal({ children }: { children: React.ReactNode }) {
  const wide = useAppLayout().width >= 600,
    safe = useSafeAreaInsets();
  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 10, justifyContent: 'center' }]}
      accessibilityViewIsModal
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3940' }]} />
      <View
        style={[
          fiCard,
          wide
            ? {
                alignSelf: 'flex-end',
                marginRight: Math.max(24, safe.right),
                width: 330,
                padding: 20,
                maxHeight: '94%',
              }
            : { marginHorizontal: 20, padding: 24, maxHeight: '85%' },
        ]}
      >
        {children}
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
