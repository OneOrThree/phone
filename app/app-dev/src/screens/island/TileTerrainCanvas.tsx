import React, { useEffect, useMemo, useState } from 'react';
import {
  Atlas,
  Canvas,
  Circle,
  Group,
  Path,
  rect,
  Skia,
  useImage,
  type SkRect,
  type SkRSXform,
} from '@shopify/react-native-skia';
import type { NavGrid } from '@/utils/nav-path';
import bundledTilemap from '@/assets/village-world/v1/tilemap.json';
import bundledTileset from '@/assets/village-world/v1/tileset.json';
import {
  type MapAssetSource,
  type TilesetFile,
  readMapJson,
  tilesetUri,
} from '@/services/mapAssets';

type Point = { x: number; y: number };

// 타일 섬 지형(GROMO-2230): 기존 마을 바닥 원화 한 장 대신 tileset@2x.png(밤은 tileset-night@2x.png) 의 384 조각을 Atlas 한 번(드로우콜 1)으로 그린다.
// 건물은 지금처럼 기존 레이어 이미지가 RN 뷰로 그린다 — 한 캔버스로 합치는 건 실기기 측정 뒤 다음 단계.
// 실기기 측정 항목: tileset@2x.png 는 4096×2048 RGBA(≈32 MB)라 최대 텍스처 크기가 4096 인 일부 저사양 Android 기기에서
// 한계에 걸리거나 메모리 부담이 될 수 있다. 코드는 그대로 두고 실기기에서 로드·메모리를 확인한다.

// 개발 확인용 이동 보기(`navDebug`, FinalIsland 의 개발 버튼): 타일 경계선 · 막힌 nav 셀 · 마지막 걷기(탭→보정 목적지·경로)를
// 그려 준다. 버튼이 CAN_PREVIEW_VILLAGE 로만 뜨고 그리기는 prop 이 있을 때만이라 배포 빌드에서는 그려지지 않는다.
export type NavWalk = { tap: Point; path: Point[] };
/** 서버 확정 경로·스냅샷·예측 오차(GROMO-2249), 전부 1x 이미지 px. 이동 동기화가 꺼져 있으면 전부 null. */
export type NavServerDebug = {
  /**
   * off(동기화 꺼짐)·denied(거절)·live(정상). off 는 보통 server 자체가 null 로 표현된다
   * (WorldMap 의 컨트롤러 없음 분기) — 이 값은 denied·live 를 구분하는 용도다(GROMO-2249 보완).
   */
  status: 'off' | 'denied' | 'live';
  /** PathAccepted 출발점 + waypoints. */
  path: Point[] | null;
  /** path 가 속한 서버 경로 식별자(PathAccepted.pathId) — path 비교 1순위로 쓴다(GROMO-2249 보완4 지적 3). */
  pathId: number | null;
  /** 최근 Snapshot 의 내 위치. */
  snapshot: Point | null;
  /** 앱 예측 위치(WorldMap 의 location.current). */
  predicted: Point | null;
  /** 마지막 onMyCorrection 호출 시각(ms) — 500ms 안이면 깜빡인다. */
  correctedAt: number | null;
  /** 최근 Snapshot 을 받은 시각(ms, 절대) — 틱 지연은 readout 이 now 로 계산한다(GROMO-2249 보완). */
  snapshotReceivedAt: number | null;
  /** intent 를 보냈는데 아직 PathAccepted·MoveRejected 를 못 받은 상태의 시작 시각(ms). */
  waitingSince: number | null;
};
export type NavDebug = { nav: NavGrid; walk: NavWalk | null; server?: NavServerDebug | null };
const IMAGE_W = 1536,
  IMAGE_H = 1024;

/** nav 100×100 의 막힌 셀을 한 경로(1x 이미지 좌표)로 묶는다. */
export function buildBlockedPath(nav: NavGrid) {
  const path = Skia.PathBuilder.Make();
  const cw = IMAGE_W / nav.cols,
    ch = IMAGE_H / nav.rows;
  for (let i = 0; i < nav.walkable.length; i++) {
    if (nav.walkable[i]) continue;
    const x = (i % nav.cols) * cw,
      y = Math.floor(i / nav.cols) * ch;
    path
      .moveTo(x, y)
      .lineTo(x + cw, y)
      .lineTo(x + cw, y + ch)
      .lineTo(x, y + ch)
      .close();
  }
  return path.build();
}

/** 마지막 걷기 한 줄 요약 — 경로 칸 수 · 탭과 보정 목적지의 거리(px) · nav 출처. */
function walkSummary(walk: NavWalk | null, kind: MapAssetSource['kind']) {
  if (!walk) return `경로 없음 · nav ${kind}`;
  const dest = walk.path[walk.path.length - 1];
  const gap = dest ? Math.round(Math.hypot(dest.x - walk.tap.x, dest.y - walk.tap.y)) : 0;
  return `경로 ${Math.max(walk.path.length - 1, 0)}칸 · 보정 ${gap}px · nav ${kind}`;
}

/**
 * 서버 Δ(예측-스냅샷 거리)·틱 지연 한 줄, 또는 대기/거절/없음(GROMO-2249, 보완).
 * 대기(waitingSince)가 최우선이다 — 첫 Snapshot 뒤 새 이동 명령을 보내도 지난 snapshot·predicted 가
 * 남아 있어 Δ·지연 조건이 계속 참이 된다. 그 묵은 값보다 지금 서버 응답을 기다린다는 사실을 먼저 보여준다(지적 1).
 * snapshotReceivedAt 은 절대 시각이라 틱 지연(now - snapshotReceivedAt)은 여기서 매번 새로 계산한다.
 * now(호출자의 debugNow)가 새 스냅샷 수신 직후 아직 갱신 전이면 snapshotReceivedAt 보다 과거일 수 있어
 * 두 값 모두 0 으로 클램프한다(보완5 지적 2) — 그래야 「틱 지연 -12ms」처럼 음수로 보이지 않는다.
 */
function serverDebugLine(server: NavServerDebug, now: number) {
  if (server.status === 'denied') return '동기화 거절됨';
  if (server.status === 'off') return '서버 없음';
  const { snapshot, predicted, snapshotReceivedAt, waitingSince } = server;
  if (waitingSince !== null) return `서버 대기 ${Math.max(0, Math.round(now - waitingSince))}ms`;
  if (snapshot && predicted && snapshotReceivedAt !== null) {
    const delta = Math.round(Math.hypot(predicted.x - snapshot.x, predicted.y - snapshot.y));
    const lag = Math.max(0, Math.round(now - snapshotReceivedAt));
    return `서버 Δ ${delta}px · 틱 지연 ${lag}ms`;
  }
  return '서버 없음';
}

/** 마지막 걷기 한 줄 요약, server 가 있으면 둘째 줄로 서버 Δ·지연/대기/거절/없음을 더한다(GROMO-2249). */
export function navDebugText(
  walk: NavWalk | null,
  kind: MapAssetSource['kind'],
  server?: NavServerDebug | null,
  now: number = Date.now(),
) {
  const summary = walkSummary(walk, kind);
  // server 를 아예 안 주면(기존 호출) 둘째 줄이 없다 — 기존 동작 불변. null 은 "동기화 꺼짐(off)"을 명시한
  // 호출이라 「서버 없음」을 보여준다 — status:'off' 객체와 같은 문구다(GROMO-2249 보완 — 항목 2·5).
  if (server === undefined) return summary;
  return `${summary}\n${server ? serverDebugLine(server, now) : '서버 없음'}`;
}

function polyline(points: Point[]) {
  const b = Skia.PathBuilder.Make();
  points.forEach((p, i) => (i ? b.lineTo(p.x, p.y) : b.moveTo(p.x, p.y)));
  return b.build();
}

/** 예측 → 서버 위치 화살표(자루 + 끝 쉐브론), 1x 이미지 좌표. scale 로 나눠 화면 크기를 고정한다(GROMO-2249). */
export function buildArrowPath(from: Point, to: Point, scale: number) {
  const b = Skia.PathBuilder.Make();
  b.moveTo(from.x, from.y).lineTo(to.x, to.y);
  const dx = to.x - from.x,
    dy = to.y - from.y,
    len = Math.hypot(dx, dy);
  if (len > 0) {
    const ux = dx / len,
      uy = dy / len,
      back = 12 / scale,
      half = 4 / scale,
      bx = to.x - ux * back,
      by = to.y - uy * back;
    // 자루는 열린 선, 쉐브론은 끝점에서 양쪽으로 벌어진 두 선 — 한 Path 를 stroke 로만 그린다(채우기 없음).
    b.moveTo(bx - uy * half, by + ux * half)
      .lineTo(to.x, to.y)
      .lineTo(bx + uy * half, by - ux * half);
  }
  return b.build();
}

/** 보정 직후 500ms 만 깜빡인다 — now 를 외부에서 받는 순수 함수라 테스트 가능하다(GROMO-2249). */
export function correctionFlash(correctedAt: number | null, now: number): boolean {
  return correctedAt !== null && now - correctedAt < 500;
}

/** 1x 이미지 좌표의 타일 격자선(세로 columns+1 · 가로 rows+1). */
export function buildTileGridPath(tilemap: {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
}) {
  const path = Skia.PathBuilder.Make();
  const w = tilemap.width * tilemap.tilewidth,
    h = tilemap.height * tilemap.tileheight;
  for (let c = 0; c <= tilemap.width; c++)
    path.moveTo(c * tilemap.tilewidth, 0).lineTo(c * tilemap.tilewidth, h);
  for (let r = 0; r <= tilemap.height; r++)
    path.moveTo(0, r * tilemap.tileheight).lineTo(w, r * tilemap.tileheight);
  return path.build();
}

/** tilemap 의 terrain 레이어를 아틀라스 소스 rect(2x)·목적지 rsxform(1x)으로 바꾼다. gid 0 은 빈 칸. */
export function buildTerrainAtlas(assets: MapAssetSource) {
  // 화면 스냅샷(GROMO-2233)이 cache 면 캐시본, 아니면 번들 — 이미지와 같은 버전에서 읽는다.
  const tilemap = readMapJson('tilemap.json', bundledTilemap, assets);
  const tileset = readMapJson('tileset.json', bundledTileset, assets);
  const terrain = tilemap.layers.find((layer) => layer.name === 'terrain')!;
  const { tilewidth, tileheight, margin, spacing, columns, scale } = tileset;
  const sprites: SkRect[] = [],
    transforms: SkRSXform[] = [];
  for (let i = 0; i < terrain.data.length; i++) {
    const gid = terrain.data[i];
    if (!gid) continue;
    const slot = gid - 1;
    sprites.push(
      rect(
        margin + (slot % columns) * (tilewidth + spacing),
        margin + Math.floor(slot / columns) * (tileheight + spacing),
        tilewidth,
        tileheight,
      ),
    );
    // 2x 원화를 1/scale 로 줄여 1x 이미지 좌표(지형 1536×1024)에 놓는다. 회전 없음.
    transforms.push(
      Skia.RSXform(
        1 / scale,
        0,
        (i % tilemap.width) * tilemap.tilewidth,
        Math.floor(i / tilemap.width) * tilemap.tileheight,
      ),
    );
  }
  return { sprites, transforms };
}

/**
 * WorldMap 의 지형 `<Image>` 와 같은 투영(scale = base·z, 화면 중앙에 camera.x·y)을 Group transform 하나로 적용한다.
 * 샘플링은 기본(bilinear) — 원화를 자른 타일이라 nearest 로 두면 줌에서 계단이 생긴다.
 * ponytail: 카메라는 React state 라 팬·줌마다 이 컴포넌트가 다시 렌더된다(배열은 이미지 로드 뒤 useMemo 로 한 번만).
 * 측정에서 p95 16.7ms 를 넘으면 camera 를 Reanimated shared value 로 옮겨 Group transform 만 UI 스레드에서 바꾼다.
 */
export function TileTerrainCanvas({
  width,
  height,
  camera,
  base,
  night,
  assets,
  onAssetsFail,
  navDebug,
}: {
  width: number;
  height: number;
  camera: { x: number; y: number; z: number };
  base: number;
  /** 밤이면 tileset-night@2x.png. 낮·밤은 같은 tilemap 을 쓴다. */
  night: boolean;
  /** 화면 스냅샷. 이미지·tilemap·tileset 이 모두 이 소스에서 나온다. */
  assets: MapAssetSource;
  /** 캐시 PNG 디코드 실패 알림 — 부모가 전역 소스를 번들로 내리고 스냅샷을 번들로 바꾼다. */
  onAssetsFail?: (file: TilesetFile) => void;
  /** 개발 전용 이동 보기. 없으면 아무것도 더 그리지 않는다. */
  navDebug?: NavDebug | null;
}) {
  // Metro 는 `@2x` 를 배율 접미사로 읽어 파일명 그대로는 못 찾는다 — 기본 이름으로 부르면 tileset@2x.png(밤 tileset-night@2x.png) 변형을 고른다.
  // 스냅샷이 cache 면 파일 URI(GROMO-2233). 소스는 마운트 때 고정되고, 디코드 실패 때만 부모가 번들로 바꾼다.
  // 번들 쪽은 Metro 의 @2x 배율 해석에 기댄 우회, Expo 57 / `expo export --platform ios` 로 확인(2026-10-08).
  // 낮·밤이 바뀌면 소스가 바뀌어 useImage 가 다시 로드한다.
  const file: TilesetFile = night ? 'tileset-night@2x.png' : 'tileset@2x.png';
  const source = useMemo(
    () =>
      tilesetUri(assets, file) ??
      (file === 'tileset-night@2x.png'
        ? require('@/assets/village-world/v1/tileset-night.png')
        : require('@/assets/village-world/v1/tileset.png')),
    [assets, file],
  );
  // 캐시 PNG 가 깨져 디코드에 실패하면 빈 섬이 되지 않게 소스 전체를 번들로 강등한다(번들 이미지는 다시 로드).
  const image = useImage(source, () => {
    if (assets.kind === 'cache') onAssetsFail?.(file);
  });
  // 실기기 게이트(디코드 해상도 4096×2048 단언)용 — 개발 빌드에서만 한 번 찍는다.
  const decoded = image ? `${image.width()}x${image.height()}` : null;
  useEffect(() => {
    if (__DEV__ && decoded) console.log(`[TileTerrainCanvas] 디코드 ${decoded} (${assets.kind})`);
  }, [decoded, assets.kind]);
  // 이미지가 뜬 뒤 한 번만 만든다. 로드 전에는 기존 Image 처럼 아무것도 그리지 않는다(뒤의 바다 배경이 보인다).
  const atlas = useMemo(() => (image ? buildTerrainAtlas(assets) : null), [image, assets]);
  const nav = navDebug?.nav;
  const grid = useMemo(
    () => (nav ? buildTileGridPath(readMapJson('tilemap.json', bundledTilemap, assets)) : null),
    [nav, assets],
  );
  const blocked = useMemo(() => (nav ? buildBlockedPath(nav) : null), [nav]);
  const walk = navDebug?.walk;
  const walkPath = useMemo(() => (walk ? polyline(walk.path) : null), [walk]);
  const tapLine = useMemo(() => {
    const dest = walk?.path[walk.path.length - 1];
    return walk && dest ? polyline([walk.tap, dest]) : null;
  }, [walk]);
  // 서버 확정 경로·보정 깜빡임(GROMO-2249) — server 가 없으면(동기화 꺼짐) 아무것도 계산·타이머도
  // 없다. flashNow 는 이 캔버스의 보정 깜빡임(노란 원) 판정에만 쓴다 — 틱 지연 readout 문구는
  // WorldMap 이 자기 시계(debugNow)로 따로 갱신한다(navDebugText 호출은 WorldMap 쪽에만 있고 이
  // 캔버스 안에는 없다). 그래서 live 여도 창이 끝나면 더 돌 필요가 없다(보완4 가 넣은 live 500ms
  // 분기는 그 전제가 틀려 보완6 에서 되돌린다 — 프리-PR 5라운드 지적 1). correctedAt 이 깜빡임
  // 창(500ms) 안일 때만 50ms 로 돌고, 창이 끝나면 스스로 clear 한다(라운드1 지적 1 원복).
  const server = navDebug?.server;
  const correctedAt = server?.correctedAt ?? null;
  const [flashNow, setFlashNow] = useState(() => Date.now());
  useEffect(() => {
    if (!correctionFlash(correctedAt, Date.now())) return;
    const id = setInterval(() => {
      const now = Date.now();
      setFlashNow(now);
      if (!correctionFlash(correctedAt, now)) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [correctedAt]);
  if (!image || !atlas) return null;
  const scale = base * camera.z;
  const serverPath = server?.path && server.path.length > 1 ? polyline(server.path) : null;
  const arrow =
    server?.predicted && server?.snapshot
      ? buildArrowPath(server.predicted, server.snapshot, scale)
      : null;
  const flash = correctionFlash(correctedAt, flashNow);
  return (
    <Canvas pointerEvents="none" style={{ position: 'absolute', width, height }}>
      <Group
        transform={[
          { translateX: width / 2 - camera.x * scale },
          { translateY: height / 2 - camera.y * scale },
          { scale },
        ]}
      >
        <Atlas image={image} sprites={atlas.sprites} transforms={atlas.transforms} />
        {grid && (
          <Path path={grid} style="stroke" strokeWidth={1 / scale} color="rgba(255,0,0,0.6)" />
        )}
        {blocked && <Path path={blocked} color="rgba(120,0,0,0.35)" />}
        {tapLine && (
          <Path
            path={tapLine}
            style="stroke"
            strokeWidth={1.5 / scale}
            color="rgba(200,200,200,0.9)"
          />
        )}
        {walkPath && (
          <Path
            path={walkPath}
            style="stroke"
            strokeWidth={3 / scale}
            color="rgba(30,110,255,0.9)"
          />
        )}
        {walk && walk.path.length > 0 && (
          <>
            <Circle cx={walk.path[0].x} cy={walk.path[0].y} r={6 / scale} color="white" />
            <Circle cx={walk.tap.x} cy={walk.tap.y} r={6 / scale} color="yellow" />
            <Circle
              cx={walk.path[walk.path.length - 1].x}
              cy={walk.path[walk.path.length - 1].y}
              r={6 / scale}
              color="lime"
            />
          </>
        )}
        {/* 서버 확정 경로·스냅샷·예측 오차(GROMO-2249) — 기존 파란 로컬 선 위에 주황으로 겹쳐 그린다. */}
        {serverPath && (
          <Path
            path={serverPath}
            style="stroke"
            strokeWidth={3 / scale}
            color="rgba(255,140,0,0.9)"
          />
        )}
        {server?.snapshot && (
          <Circle
            cx={server.snapshot.x}
            cy={server.snapshot.y}
            r={6 / scale}
            color="rgba(255,140,0,0.9)"
          />
        )}
        {arrow && (
          <Path path={arrow} style="stroke" strokeWidth={2 / scale} color="rgba(255,140,0,0.9)" />
        )}
        {flash && server?.predicted && (
          <Circle
            cx={server.predicted.x}
            cy={server.predicted.y}
            r={12 / scale}
            color="rgba(255,255,0,0.8)"
          />
        )}
      </Group>
    </Canvas>
  );
}
