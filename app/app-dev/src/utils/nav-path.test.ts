import nav from '@/assets/village-world/v1/nav.json';
import {
  loadNav,
  navPath,
  resolveTarget,
  stepDurationMs,
  tilePath,
  tapToWorld,
  MS_PER_UNIT,
} from './nav-path';
import { cellCenterToWorld, imageToWorld, worldToCell, worldToImage } from './worldCoords';

const real = loadNav(nav as any);
const synth = (rows: string[], costs?: number[]) => {
  const w = rows[0].length;
  const walkable = rows.join('');
  return loadNav({
    columns: w,
    rows: rows.length,
    walkable,
    traversalCost: costs ?? [...walkable].map(() => 10),
  });
};
const center = (cx: number, cy: number) => cellCenterToWorld({ cx, cy });

describe('tapToWorld', () => {
  it('같은 이미지 지점은 줌·화면 크기와 무관하게 같은 world', () => {
    const img = { x: 700, y: 400 };
    const out = [0.35, 1, 2.6].flatMap((scale) =>
      [390, 430].map(() => {
        const w = tapToWorld(
          { locationX: img.x * scale, locationY: img.y * scale },
          { scale, imageWidth: 1536, imageHeight: 1024 },
        );
        return [w.x.toFixed(6), w.y.toFixed(6)].join();
      }),
    );
    expect(new Set(out).size).toBe(1);
  });
});

describe('v1 nav.json A*', () => {
  const g = real;
  it('spawn → entrance 7곳 경로 존재, 모두 통행 셀, 모서리 관통 0', () => {
    const from = center(nav.spawns.character.cx, nav.spawns.character.cy);
    const entrances = Object.values(nav.entrances);
    expect(entrances).toHaveLength(7);
    for (const en of entrances) {
      const path = navPath(g, from, center(en.cx, en.cy));
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual(center(en.cx, en.cy));
      let prev = worldToCell(from);
      for (const p of path) {
        const c = worldToCell(p);
        expect(g.walkable[c.cy * g.cols + c.cx]).toBe(1);
        const dx = c.cx - prev.cx,
          dy = c.cy - prev.cy;
        expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
        if (dx && dy) {
          expect(g.walkable[prev.cy * g.cols + c.cx]).toBe(1);
          expect(g.walkable[c.cy * g.cols + prev.cx]).toBe(1);
        }
        prev = c;
      }
    }
  });
});

describe('미완공 건물 자리 · 막힌 간선', () => {
  const bc = nav.buildingCells as Record<string, number[]>;
  const all = Object.keys(bc);
  const empty = loadNav(nav as any, []);
  const full = loadNav(nav as any, all);
  const from = center(nav.spawns.character.cx, nav.spawns.character.cy);
  it('건물 0 섬에선 hall 자리가 통행, 전부 완공이면 차단', () => {
    for (const i of bc.hall) {
      expect(empty.walkable[i]).toBe(1);
      expect(full.walkable[i]).toBe(0);
    }
    expect(loadNav(nav as any, [])).toBe(empty);
  });
  it('스폰 → hall 입구 경로가 두 경우 모두 존재', () => {
    const en = nav.entrances.hall;
    for (const g of [empty, full])
      expect(navPath(g, from, center(en.cx, en.cy)).length).toBeGreaterThan(0);
  });
  it('nav.json 의 blockedEdges 전체는 어떤 경로에도 등장하지 않는다', () => {
    const bad = new Set((nav.blockedEdges as number[][]).map(([a, b]) => `${a},${b}`));
    for (const g of [empty, full])
      for (const en of Object.values(nav.entrances)) {
        const pts = [from, ...navPath(g, from, center(en.cx, en.cy))].map((p) => {
          const c = worldToCell(p);
          return c.cy * 100 + c.cx;
        });
        for (let k = 1; k < pts.length; k++)
          expect(bad.has(`${Math.min(pts[k - 1], pts[k])},${Math.max(pts[k - 1], pts[k])}`)).toBe(
            false,
          );
      }
  });
  it('직교 이동에서 blockedEdges 간선을 건너뛴다', () => {
    const r = loadNav({
      columns: 2,
      rows: 1,
      walkable: '11',
      traversalCost: [10, 10],
      blockedEdges: [[0, 1]],
    });
    expect(navPath(r, center(0, 0), center(1, 0))).toEqual([]);
  });
});

describe('resolveTarget', () => {
  it('다른 섬 탭은 출발 영역 안 최근접 셀로 보정한다', () => {
    const g = synth(['110011', '110011', '110011']);
    expect(resolveTarget(g, center(0, 0), center(4, 1))?.target).toEqual({ cx: 1, cy: 1 });
  });
  it('바다 탭의 동률은 index 작은 셀', () => {
    const g = synth(['111', '101', '111']);
    // (1,1) 은 바다 — 상하좌우 네 셀이 거리 1 로 동률, index 가장 작은 (1,0)
    expect(resolveTarget(g, center(0, 0), center(1, 1))?.target).toEqual({ cx: 1, cy: 0 });
  });
  it('출발 셀이 비통행이면 최근접 통행 셀에서 시작한다', () => {
    const g = synth(['011']);
    expect(navPath(g, center(0, 0), center(2, 0)).map((p) => p.x)).toEqual([2.5]);
  });
});

describe('stepDurationMs', () => {
  it('가로 5칸과 세로 5칸의 합이 같고 대각 1칸은 √2배', () => {
    const sum = (pts: { x: number; y: number }[]) =>
      pts.slice(1).reduce((a, p, i) => a + stepDurationMs(pts[i], p), 0);
    const h = [0, 1, 2, 3, 4, 5].map((i) => ({ x: i, y: 0 }));
    const v = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 0, y: i }));
    expect(sum(h)).toBeCloseTo(5 * MS_PER_UNIT, 6);
    expect(sum(v)).toBeCloseTo(sum(h), 6);
    expect(stepDurationMs({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(Math.SQRT2 * MS_PER_UNIT, 6);
  });
});

describe('휴리스틱 허용성', () => {
  it('합성 격자에서 A* 경로 비용이 다익스트라 참값과 같다', () => {
    const rows = ['1111111', '1000001', '1011101', '1010101', '1010001', '1111111'];
    const costs = [...rows.join('')].map((_, i) => (i % 3 === 0 ? 27 : 8));
    const g = synth(rows, costs);
    const from = center(0, 0),
      to = center(6, 4);
    const pathCost = (pts: { x: number; y: number }[]) => {
      let prev = from,
        total = 0;
      for (const p of pts) {
        const c = worldToCell(p);
        total += Math.hypot(p.x - prev.x, p.y - prev.y) * (g.cost[c.cy * g.cols + c.cx] / 10);
        prev = p;
      }
      return total;
    };
    // 다익스트라(h = 0) 참값
    const n = g.walkable.length;
    const d = new Array(n).fill(Infinity);
    const s = 0,
      e = 4 * 7 + 6;
    d[s] = 0;
    const done = new Set<number>();
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++)
        if (!done.has(i) && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0) break;
      done.add(u);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = (u % 7) + dx,
            y = Math.floor(u / 7) + dy;
          if ((!dx && !dy) || x < 0 || y < 0 || x >= 7 || y >= 6) continue;
          const q = y * 7 + x;
          if (!g.walkable[q]) continue;
          if (dx && dy && (!g.walkable[y * 7 + (u % 7)] || !g.walkable[Math.floor(u / 7) * 7 + x]))
            continue;
          d[q] = Math.min(d[q], d[u] + Math.hypot(dx, dy) * (g.cost[q] / 10));
        }
    }
    expect(pathCost(navPath(g, from, to))).toBeCloseTo(d[e], 9);
  });
});

describe('tilePath (walk 의 done 호출 조건)', () => {
  const size = { imageWidth: 1536, imageHeight: 1024 };
  const px = (cx: number, cy: number) => worldToImage(center(cx, cy), size);

  it('같은 셀 목적지는 [from] — 길이 1이라 walk 가 done 을 부른다', () => {
    const from = px(3, 1);
    expect(tilePath(synth(['1111', '1111']), from, from, size)).toEqual([from]);
  });
  it('도달 불가(빈 목적지 보정 실패)는 []', () => {
    expect(tilePath(synth(['0000']), px(0, 0), px(1, 0), size)).toEqual([]);
  });
  it('입구 7곳을 같은 목적지로 두 번 연속 걷기 — 두 번째는 같은 셀이어도 비어 있지 않다', () => {
    let at = worldToImage(center(nav.spawns.character.cx, nav.spawns.character.cy), size);
    for (const en of Object.values(nav.entrances)) {
      const dest = worldToImage(center(en.cx, en.cy), size);
      const first = tilePath(real, at, dest, size);
      expect(first.length).toBeGreaterThan(1);
      at = first[first.length - 1];
      const second = tilePath(real, at, dest, size);
      expect(second.length).toBeGreaterThanOrEqual(1);
      expect(imageToWorld(second[0], size)).toEqual(imageToWorld(at, size));
    }
  });
});

describe('모서리 관통 금지(규칙 ⑤) — 합성 3×3', () => {
  const diag = (rows: string[]) => {
    const g = synth(rows);
    // (0,0) → (1,1) 인접 대각을 한 걸음으로 갈 수 있는지(경로 길이 1 + 직선 거리 √2).
    const path = navPath(g, center(0, 0), center(1, 1));
    return path.length === 1;
  };
  it('(1,0) 이 막히면 대각 금지', () => expect(diag(['101', '111', '111'])).toBe(false));
  it('(0,1) 이 막히면 대각 금지', () => expect(diag(['111', '011', '111'])).toBe(false));
  it('둘 다 열리면 대각 허용', () => expect(diag(['111', '111', '111'])).toBe(true));
});

describe('loadNav 입력 검증', () => {
  it('walkable 길이가 columns*rows 와 다르면 throw', () => {
    expect(() =>
      loadNav({ columns: 2, rows: 2, walkable: '111', traversalCost: [10, 10, 10, 10] }),
    ).toThrow(/walkable/);
  });
  it('통행 셀의 비용이 0 이면 throw', () => {
    expect(() => loadNav({ columns: 2, rows: 1, walkable: '11', traversalCost: [10, 0] })).toThrow(
      /traversalCost\[1\]/,
    );
  });
});
