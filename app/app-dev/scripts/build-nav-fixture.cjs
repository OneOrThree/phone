// 기존 마을 통행 격자(src/constants/world-v2.json home, 96×64)에서 타일 섬 계약 fixture(v1/)를 결정적으로 만든다.
// 같은 입력이면 바이트까지 같다. 사용: node scripts/build-nav-fixture.cjs [--check]
// 통행 판정은 src/utils/world-grid.ts 의 onLand(grids.home, p) 와 같은 식이다(그쪽 동작은 바꾸지 않는다).
// 통행 셀: 100×100 셀 중심점 1점을 onLand 로 판정한다.
// 간선(blockedEdges): 직교 인접 통행 셀 쌍의 중심↔중심 선분을 EDGE_SAMPLES 등분해 끝점을 뺀 내부 점들을 모두 검사하고, 하나라도 막히면 차단 간선으로 둔다(중점 1점만 보면 놓친다).

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../src/constants/world-v2.json');
const OUT = path.join(__dirname, '../src/assets/village-world/v1');
const N = 100; // 통행 셀 100×100, 1 셀 = 1 world unit
const EDGE_SAMPLES = 32; // 선분 내부 31점
// ponytail: 기존 마을은 길이 원화에 그려져 있어 길 데이터가 없다 — 전 셀 잔디 비용 하나(기존 landPath 도 균일 BFS 라 동작은 같다).
// 길을 선호하게 하려면 그려진 길 마스크를 만들어 길 셀만 8 로 낮춘다.
const GRASS_COST = 27; // 정수 ×10
// 기존 마을 건물 입구 px·첫 자리 — WorldMap.tsx 와 같은 src/constants/legacy-doors.json 한 곳을 읽는다.
const legacy = require('../src/constants/legacy-doors.json');
const BUILDINGS = ['hall', 'library', 'shop', 'tower', 'board', 'gram', 'mail'];
const DOORS = Object.fromEntries(BUILDINGS.map((b) => [b, legacy.doors[b]]));
const SPAWN = legacy.spawn;

const g = JSON.parse(fs.readFileSync(SRC, 'utf8')).home;

// world-grid.ts onLand 와 같은 식.
function openAtPx(p) {
  if (!(p.x >= 0 && p.y >= 0 && p.x < g.w && p.y < g.h)) return false;
  return (
    g.cells[Math.floor((p.y / g.h) * g.rows) * g.cols + Math.floor((p.x / g.w) * g.cols)] === '1'
  );
}
const center = (cx, cy) => ({ x: (cx + 0.5) * (g.w / N), y: (cy + 0.5) * (g.h / N) });
// 두 중심 사이 선분의 내부 점(t=1/EDGE_SAMPLES … (n-1)/n)이 전부 통행이면 true.
function edgeOpen(a, b) {
  for (let k = 1; k < EDGE_SAMPLES; k++) {
    const t = k / EDGE_SAMPLES;
    if (!openAtPx({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
  }
  return true;
}

function build() {
  const walk = [];
  for (let i = 0; i < N * N; i++) walk.push(openAtPx(center(i % N, Math.floor(i / N))) ? '1' : '0');
  // px 거리로 가장 가까운 통행 셀(동률은 index 작은 쪽).
  const nearest = (p) => {
    let best = -1,
      bestD = Infinity;
    for (let i = 0; i < N * N; i++) {
      if (walk[i] !== '1') continue;
      const c = center(i % N, Math.floor(i / N));
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { cx: best % N, cy: Math.floor(best / N) };
  };
  const blockedEdges = [];
  for (let i = 0; i < N * N; i++) {
    if (walk[i] !== '1') continue;
    const a = center(i % N, Math.floor(i / N));
    for (const [dx, dy, ok] of [
      [1, 0, i % N < N - 1],
      [0, 1, i < N * (N - 1)],
    ]) {
      const j = i + dx + dy * N;
      if (!ok || walk[j] !== '1') continue;
      if (!edgeOpen(a, center(j % N, Math.floor(j / N)))) blockedEdges.push([i, j]);
    }
  }
  const home = {
    '$schema-note':
      '타일 맵 스키마(docs/prd/fishcat/island-movement/map-assets.md §2). 10/9 는 해시 대신 고정 파일명을 쓴다. 타일셋은 기존 마을 바닥 원화(낮 tileset, 밤 tilesetNight)이고 scripts/build-tile-atlas.py 가 만든다.',
    mapId: 'home',
    mapVersion: 1,
    coordinateVersion: 1,
    imageWidth: g.w,
    imageHeight: g.h,
    tiles: {
      size: 64,
      columns: 24,
      rows: 16,
      tileset: 'tileset@2x.png',
      tilesetNight: 'tileset-night@2x.png',
      map: 'tilemap.json',
    },
    nav: { columns: N, rows: N, file: 'nav.json' },
    layers: ['terrain', 'terrain-detail', 'roads'],
  };
  const nav = {
    '$schema-note':
      'NavArtifact 모양의 통행 파일(100×100, 행 우선). 원천은 기존 마을 통행 격자 src/constants/world-v2.json home(96×64)이고 셀 중심을 onLand 로 판정한다. walkable 은 "0"/"1" 문자열. traversalCost 는 정수 ×10 이며 기존 마을은 길이 원화에 그려져 길 데이터가 없어 전 셀 잔디 27 이다. buildingCells 는 건물별 빈 배열(기존 격자는 건설로 바뀌지 않는다), blockedEdges 는 중심 선분 위 31점 중 막힌 점이 있어 건너지 못하는 인접 쌍[a,b] (a<b). entrances·spawns 는 기존 마을 입구·첫 자리 px 에 가장 가까운 통행 셀. 생성: scripts/build-nav-fixture.cjs.',
    columns: N,
    rows: N,
    walkable: walk.join(''),
    traversalCost: walk.map(() => GRASS_COST),
    buildingCells: Object.fromEntries(Object.keys(DOORS).map((b) => [b, []])),
    blockedEdges,
    entrances: Object.fromEntries(Object.entries(DOORS).map(([id, d]) => [id, nearest(d)])),
    spawns: { character: nearest(SPAWN) },
  };
  // 숫자만 든 배열은 한 줄로 접어 diff 와 크기를 줄인다.
  const fmt = (v) =>
    JSON.stringify(v, null, 2).replace(
      /\[\s*(-?\d[\d.,\s-]*?)\s*\]/g,
      (_, a) => `[${a.replace(/\s+/g, '')}]`,
    ) + '\n';
  return { 'home.map.json': fmt(home), 'nav.json': fmt(nav) };
}

module.exports = { build, openAtPx, center, edgeOpen, DOORS, SPAWN };

if (require.main === module) {
  const files = build();
  if (process.argv.includes('--check')) {
    const stale = Object.keys(files).filter((f) => {
      try {
        return fs.readFileSync(path.join(OUT, f), 'utf8') !== files[f];
      } catch {
        return true;
      }
    });
    if (stale.length) {
      console.error(`fixture 가 최신이 아니다: ${stale.join(', ')} — npm run gen:nav-fixture`);
      process.exit(1);
    }
  } else {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), text);
  }
}
