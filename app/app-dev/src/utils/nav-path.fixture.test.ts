// 앱·서버 공통 A* fixture(docs/prd/fishcat/island-movement/fixtures/paths.json)를 만들고 검사한다.
// 서버 PathfinderTest 와 nav-path.test.ts 가 이 파일을 읽어 start·goal·cost·path 를 단언한다.
// 쓰기: npm run gen:path-fixture (WRITE_PATH_FIXTURE=1) · 검사: npm run gen:path-fixture:check (일반 jest 도 검사).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nav from '@/assets/village-world/v1/nav.json';
import { NavJson, loadNav, navPathDetailed } from './nav-path';
import { WorldPoint, imageToWorld } from './worldCoords';

const FIXTURE = path.join(
  __dirname,
  '../../../../docs/prd/fishcat/island-movement/fixtures/paths.json',
);
const NAV_REL = 'app/app-dev/src/assets/village-world/v1/nav.json';
const NAV_FILE = path.join(__dirname, '../assets/village-world/v1/nav.json');

type Input = { name: string; from: WorldPoint; to: WorldPoint; inlineNav?: NavJson };
const at = (cx: number, cy: number) => ({ x: cx + 0.5, y: cy + 0.5 });
// 기존 마을 원화 px → 월드(1536×1024).
const px = (x: number, y: number) =>
  imageToWorld({ x, y }, { imageWidth: 1536, imageHeight: 1024 });
const SPAWN = at(nav.spawns.character.cx, nav.spawns.character.cy);
// 합성 격자: 행 문자열('1' 통행), 비용 ×10(기본 10), 막힌 직교 간선 [a, b].
const inline = (
  rows: string[],
  cost?: (x: number, y: number) => number,
  blockedEdges?: [number, number][],
) => {
  const columns = rows[0].length;
  const walkable = rows.join('');
  const traversalCost = [...walkable].map(
    (_, i) => cost?.(i % columns, Math.floor(i / columns)) ?? 10,
  );
  return {
    columns,
    rows: rows.length,
    walkable,
    traversalCost,
    ...(blockedEdges && { blockedEdges }),
  };
};

// 좌표는 nav.json 의 walkable 에서 직접 골랐다(본섬 = 스폰 영역). 바다·다른 섬은 비통행/다른 영역 셀.
const CASES: Input[] = [
  ...Object.entries(nav.entrances).map(([id, e]) => ({
    name: `스폰→입구(${id})`,
    from: SPAWN,
    to: at(e.cx, e.cy),
  })),
  { name: '다리 건너기(전망대 섬 → 본섬)', from: at(19, 18), to: at(33, 20) },
  { name: '부두 끝(뗏목 문 px 274,740)', from: SPAWN, to: px(274, 740) },
  { name: '부두 서쪽 끝', from: SPAWN, to: at(3, 79) },
  { name: '바다 탭(남쪽) → 본섬 최근접 보정', from: SPAWN, to: { x: 50.5, y: 96.5 } },
  { name: '바다 탭(북쪽) → 더 가까운 작은 섬 대신 본섬 최근접', from: SPAWN, to: { x: 60, y: 1 } },
  {
    name: '월드 경계(100,100) 탭 → 셀(99,99) 바다 → 본섬 최근접',
    from: SPAWN,
    to: { x: 100, y: 100 },
  },
  // 좌표 계약(HLD §2): 범위 밖 탭은 서버가 거부한다 — resolveTarget 이 셀 변환 전에 isInsideWorld 로 거른다(리뷰 반영).
  { name: '바다 밖 좌표 (-1, 50) 탭 → 거부(unreachable)', from: SPAWN, to: { x: -1, y: 50 } },
  { name: '범위 밖 (100.5, 50) → 거부', from: SPAWN, to: { x: 100.5, y: 50 } },
  // 경계값 100 은 isInsideWorld 가 포함(≤100)하므로 여전히 유효 — 거부 사례와 짝을 이루는 정상 경로.
  {
    name: '월드 경계(100,50) 탭 → 여전히 유효(본섬 최근접 보정)',
    from: SPAWN,
    to: { x: 100, y: 50 },
  },
  // 회관 원화 상자 [949,21,242,244] 의 가운데 — 바다가 아닌 섬 안 비통행 셀.
  { name: '건물(회관 px 1070,143) 탭 → 본섬 최근접 보정', from: SPAWN, to: px(1070, 143) },
  { name: '다른 섬(낚시섬) 탭 → 본섬 최근접 보정', from: SPAWN, to: at(88, 89) },
  { name: '뗏목(떨어진 영역) 탭 → 부두 최근접 보정', from: SPAWN, to: at(19, 84) },
  { name: '전망대 섬 숲속 고립 영역 탭 → 본섬 최근접 보정', from: SPAWN, to: at(6, 12) },
  {
    name: '출발 셀 비통행(남쪽 바다) → 최근접 통행 셀에서 출발',
    from: { x: 41, y: 89.5 },
    to: at(67, 27),
  },
  {
    name: '출발 셀 비통행(낚시섬 앞바다) → 낚시섬에서 출발, 본섬 탭은 낚시섬 안으로 보정',
    from: { x: 90.5, y: 96.5 },
    to: SPAWN,
  },
  { name: '같은 셀 탭 → 빈 경로', from: SPAWN, to: { x: 38.9, y: 45.1 } },
  { name: '가로 직선', from: at(40, 77), to: at(60, 77) },
  { name: '세로 직선', from: at(34, 15), to: at(34, 40) },
  { name: '대각 직선', from: at(55, 42), to: at(70, 57) },
  {
    name: '합성 3×3 모서리: (1,0) 막힘 → 대각 금지',
    from: at(0, 0),
    to: at(1, 1),
    inlineNav: inline(['101', '111', '111']),
  },
  {
    name: '합성 3×3 모서리: (0,1) 막힘 → 대각 금지',
    from: at(0, 0),
    to: at(1, 1),
    inlineNav: inline(['111', '011', '111']),
  },
  {
    name: '합성 3×3 모서리: 양옆 열림 → 대각 허용',
    from: at(0, 0),
    to: at(1, 1),
    inlineNav: inline(['111', '111', '111']),
  },
  {
    // f·h 가 같은 대칭 두 경로 — 우선순위 3번째 키(index)만 가른다. 역순 비교로 바꾸면 아래 길로 간다.
    name: '합성 5×3 가운데 장애물: 위·아래 대칭 경로 동률 → index 작은 쪽(위)',
    from: at(0, 1),
    to: at(4, 1),
    inlineNav: inline(['11111', '11011', '11111']),
  },
  {
    name: '합성 2×2 막힌 간선: 직교만 막고 대각 우회',
    from: at(0, 0),
    to: at(1, 0),
    inlineNav: inline(['11', '11'], undefined, [[0, 1]]),
  },
  {
    name: '합성 7×5 길(8)·잔디(27): 잔디 직선보다 길로 돌아간다',
    from: at(0, 2),
    to: at(6, 2),
    inlineNav: inline(['1111111', '1111111', '1111111', '1111111', '1111111'], (x, y) =>
      y === 4 || ((x === 0 || x === 6) && y >= 2) ? 8 : 27,
    ),
  },
  {
    name: '합성 7×6 미로 길·잔디 혼합',
    from: at(0, 0),
    to: at(6, 4),
    inlineNav: inline(['1111111', '1000001', '1011101', '1010101', '1010001', '1111111'], (x, y) =>
      (y * 7 + x) % 3 === 0 ? 27 : 8,
    ),
  },
  {
    name: '합성 3×3 바다 탭 동률 → index 작은 셀',
    from: at(0, 0),
    to: at(1, 1),
    inlineNav: inline(['111', '101', '111']),
  },
  {
    name: '합성 전부 바다 → 출발 보정 실패',
    from: at(0, 0),
    to: at(2, 0),
    inlineNav: inline(['000']),
  },
  {
    // 리뷰: 격자 크기 ≠ 100 검증 — (50,50) 은 world 범위([0,100]) 안이라 거부되지 않지만 3×3 격자 밖이다.
    // cellIndexOf 가 격자 크기(cols-1=2, rows-1=2)로 clamp 해 경계 셀 (2,2) 를 가리켜야 한다(배열 밖·틀린 셀 금지).
    name: '합성 3×3 범위 밖 탭(50,50) → 격자 크기로 클램프된 경계 셀(2,2)',
    from: at(0, 0),
    to: { x: 50, y: 50 },
    inlineNav: inline(['111', '111', '111']),
  },
  {
    // 리뷰: h 동률 — (f, h, index) 에서 h 를 빼면(= f, index 만) 같은 최적 비용의 다른 경로가 나온다.
    // 탐색(h-tie-search.js, 격자 cols*rows<=40 · 비용 혼합 · 1404 configs/219010 pairs 중 첫 사례): 6×3 전부 통행,
    // 비용은 아래 cost() 그대로. Java 비교자에서 .thenComparingLong(Node::h) 를 빼는 변이 시험으로 PathfinderTest 가
    // 이 케이스에서만 실패하는지 확인한 뒤 원복한다(영구 코드 변경 아님).
    name: '합성 6×3 비용 혼합 h 동률: h 키를 빼면 같은 비용의 다른 경로(비교자 h 항 필수)',
    from: at(5, 2),
    to: at(2, 0),
    inlineNav: inline(
      ['111111', '111111', '111111'],
      (x, y) =>
        [
          [8, 27, 27, 8, 8, 16],
          [27, 10, 8, 10, 27, 27],
          [27, 10, 10, 8, 27, 10],
        ][y][x],
    ),
  },
];

const real = loadNav(nav as NavJson);
function build(): string {
  const cases = CASES.map((c) => {
    const g = c.inlineNav ? loadNav(c.inlineNav) : real;
    const r = navPathDetailed(g, c.from, c.to);
    const cell = (i: number) => ({ cx: i % g.cols, cy: Math.floor(i / g.cols) });
    const result = r
      ? {
          start: cell(r.start),
          goal: cell(r.goal),
          cost: r.cost,
          path: r.cells.map((i) => [i % g.cols, Math.floor(i / g.cols)]),
        }
      : { unreachable: true, path: [] };
    return { ...c, ...result };
  });
  const sha = crypto.createHash('sha256').update(fs.readFileSync(NAV_FILE)).digest('hex');
  const note =
    'A* 공통 fixture — 앱 src/utils/nav-path.ts 와 서버 movement/nav/Pathfinder 가 같은 결과를 내야 한다(HLD §3). ' +
    'inlineNav 가 있으면 그 합성 격자, 없으면 nav 파일. path 는 출발 셀을 뺀 [cx,cy] 열, cost 는 고정소수점 정수(직교 한 칸 = 10⁶ × 비용/10). ' +
    'unreachable 은 출발 보정 실패(null). 생성: cd app/app-dev && npm run gen:path-fixture';
  // 케이스 한 줄씩 — diff 가 케이스 단위로 보인다.
  return `{\n  "$note": ${JSON.stringify(note)},\n  "nav": "${NAV_REL}",\n  "navSha256": "${sha}",\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`;
}

describe('A* 공통 fixture(paths.json)', () => {
  it('케이스 20건 이상, 이름 중복 없음', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
  });

  it('커밋된 파일이 지금 A* 결과와 바이트까지 같다', () => {
    const text = build();
    if (process.env.WRITE_PATH_FIXTURE === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, text);
    }
    expect(fs.existsSync(FIXTURE)).toBe(true);
    // 다르면: npm run gen:path-fixture 로 다시 만들고 서버 PathfinderTest 도 같이 돌린다.
    expect(fs.readFileSync(FIXTURE, 'utf8')).toBe(text);
  });
});
