// map.json 의 폴리곤·footprint 에서 타일 섬 계약 fixture(v1/)를 결정적으로 만든다.
// 같은 입력이면 바이트까지 같다. 사용: node scripts/build-nav-fixture.cjs [--check]
// 규칙은 src/utils/village-world.ts 의 villageScene()/blocks() 와 같다(그쪽 동작은 바꾸지 않는다).
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../src/assets/village-world/map.json');
const OUT = path.join(__dirname, '../src/assets/village-world/v1');
const N = 100; // 통행 셀 100×100, 1 셀 = 1 world unit
const PAD = 10;
// 건물 id(building) → 지금 코드의 kind. objects.json 에는 둘 다 남긴다.
const COST = { road: 8, grass: 27, blocked: 0 }; // 정수 ×10 (길 0.8, 잔디 2.7)

const map = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const cw = map.width / N; // 15.36 px
const ch = map.height / N; // 10.24 px

function inside(p, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a[1] > p.y !== b[1] > p.y && p.x < ((b[0] - a[0]) * (p.y - a[1])) / (b[1] - a[1]) + a[0])
      result = !result;
  }
  return result;
}

// village-world.ts blocks() 와 같은 식. 건물은 전부 완공으로 막는다.
// ponytail: 10/9 fixture 는 「완공 전부」 한 벌. 미완공 건물 자리는 앱이 그리지 않아 실제로는 걸을 수 있으나 배치 서버(layoutRevision)가 생기기 전까지 한 벌만 둔다.
function blocks(o, p) {
  if (o.layer === 'grass' || o.layer === 'flowers') return false;
  if (o.building)
    return (
      p.x > o.x - o.w * 0.46 - PAD &&
      p.x < o.x + o.w * 0.46 + PAD &&
      p.y > o.y - o.h * 0.22 - PAD &&
      p.y < o.y + PAD
    );
  const rx = o.kind === 'fire' ? o.w * 0.46 : o.kind === 'bush' ? o.w * 0.37 : o.w * 0.18;
  const ry = o.kind === 'fire' ? o.h * 0.38 : o.kind === 'bush' ? o.h * 0.2 : 12;
  return ((p.x - o.x) / (rx + PAD)) ** 2 + ((p.y - (o.y - ry * 0.4)) / (ry + PAD)) ** 2 < 1;
}

const center = (cx, cy, cols = N, rows = N) => ({
  x: (cx + 0.5) * (map.width / cols),
  y: (cy + 0.5) * (map.height / rows),
});
const cellOf = (px, py) => ({
  cx: Math.min(N - 1, Math.max(0, Math.floor(px / cw))),
  cy: Math.min(N - 1, Math.max(0, Math.floor(py / ch))),
});

// footprint: 막는 셀들의 외접 사각형을 통행 셀 코너 좌표(정수) 폴리곤으로. 막는 셀이 없으면 [].
function footprint(o) {
  let x0 = N,
    y0 = N,
    x1 = -1,
    y1 = -1;
  for (let cy = 0; cy < N; cy++)
    for (let cx = 0; cx < N; cx++)
      if (blocks(o, center(cx, cy))) {
        x0 = Math.min(x0, cx);
        y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx);
        y1 = Math.max(y1, cy);
      }
  return x1 < 0
    ? []
    : [
        [x0, y0],
        [x1 + 1, y0],
        [x1 + 1, y1 + 1],
        [x0, y1 + 1],
      ];
}

const polygons = [
  map.navigation.landPolygon,
  map.crossings.dock.polygon,
  map.crossings.bridge.polygon,
  map.crossings.grove,
];

// 통행 판정만 따로 뗀다. 격자 크기를 인자로 받아 villageScene() 과 셀 단위로 대조할 수 있다(패리티 테스트).
function walkableAt(cx, cy, cols = N, rows = N) {
  const p = center(cx, cy, cols, rows);
  return polygons.some((poly) => inside(p, poly)) && !map.objects.some((o) => blocks(o, p));
}

function build() {
  const walk = [];
  const cost = [];
  for (let i = 0; i < N * N; i++) {
    const p = center(i % N, Math.floor(i / N));
    const ok = walkableAt(i % N, Math.floor(i / N));
    const rc =
      Math.floor(p.y / map.roads.cellSize) * map.roads.columns +
      Math.floor(p.x / map.roads.cellSize);
    walk.push(ok ? '1' : '0');
    cost.push(!ok ? COST.blocked : map.roads.cells[rc] ? COST.road : COST.grass);
  }
  const entrances = Object.fromEntries(
    Object.entries(map.doors).map(([id, d]) => [id, cellOf(d.x, d.y)]),
  );
  const objects = map.objects.map((o) => ({
    id: o.id,
    kind: o.kind,
    building: o.building ?? null,
    layer: o.layer,
    anchor: { x: +(o.x / cw).toFixed(2), y: +(o.y / ch).toFixed(2) },
    footprint: footprint(o),
    entrance: o.building && map.doors[o.building] ? entrances[o.building] : null,
  }));
  const home = {
    '$schema-note':
      '타일 맵 스키마(docs/prd/fishcat/island-movement/map-assets.md §2). 10/9 는 해시 대신 고정 파일명을 쓴다. 타일셋 파일은 GROMO-2229 가 만든다.',
    mapId: 'home',
    mapVersion: 1,
    coordinateVersion: 1,
    imageWidth: map.width,
    imageHeight: map.height,
    tiles: { size: 64, columns: 24, rows: 16, tileset: 'tileset@2x.png', map: 'tilemap.json' },
    nav: { columns: N, rows: N, file: 'nav.json' },
    layers: ['terrain', 'terrain-detail', 'roads'],
    objectsCatalog: 'objects.json',
  };
  const nav = {
    '$schema-note':
      'NavArtifact 모양의 통행 파일(100×100, 행 우선). walkable 은 "0"/"1" 문자열 — 기존 Grid.cells 와 같은 모양이고 길이 10,000 을 눈으로 검사하기 쉬워 10/9 는 비트셋 대신 쓴다. traversalCost 는 정수 ×10(길 8, 잔디 27, 차단 0). entrances·spawns 는 통행 셀 좌표. 건물은 전부 완공 상태로 막았다(생성: scripts/build-nav-fixture.cjs).',
    columns: N,
    rows: N,
    walkable: walk.join(''),
    traversalCost: cost,
    entrances,
    spawns: { character: cellOf(map.character.x, map.character.y) },
  };
  const catalog = {
    '$schema-note':
      '오브젝트 카탈로그. anchor 는 발밑 월드 좌표(소수 2자리, zIndex=y), footprint 는 통행 셀 코너 좌표(정수) 사각형 폴리곤(막지 않으면 []), entrance 는 건물 입구 셀.',
    objects,
  };
  // 숫자만 든 배열은 한 줄로 접어 diff 와 크기를 줄인다.
  const fmt = (v) =>
    JSON.stringify(v, null, 2).replace(
      /\[\s*(-?\d[\d.,\s-]*?)\s*\]/g,
      (_, a) => `[${a.replace(/\s+/g, '')}]`,
    ) + '\n';
  return { 'home.map.json': fmt(home), 'nav.json': fmt(nav), 'objects.json': fmt(catalog) };
}

module.exports = { build, walkableAt };

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
