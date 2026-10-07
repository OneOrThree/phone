import fs from 'node:fs';
import path from 'node:path';
import map from '../map.json';
import home from './home.map.json';
import nav from './nav.json';
import catalog from './objects.json';
import { villageScene } from '@/utils/village-world';
const { build, walkableAt } = require('../../../../scripts/build-nav-fixture.cjs');

const open = (cx: number, cy: number) => nav.walkable[cy * nav.columns + cx] === '1';

// 폴리곤(px) 안에 중심이 드는 통행 가능 셀 수.
function walkableCellsIn(poly: number[][]) {
  let n = 0;
  for (let cy = 0; cy < 100; cy++)
    for (let cx = 0; cx < 100; cx++) {
      const x = (cx + 0.5) * 15.36,
        y = (cy + 0.5) * 10.24;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [ax, ay] = poly[i],
          [bx, by] = poly[j];
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      }
      if (inside && open(cx, cy)) n++;
    }
  return n;
}

describe('v1 nav fixture', () => {
  it('스키마 모양', () => {
    expect(home).toMatchObject({
      mapId: 'home',
      coordinateVersion: 1,
      nav: { columns: 100, rows: 100 },
    });
    expect(nav.walkable).toHaveLength(10000);
    expect(nav.traversalCost).toHaveLength(10000);
    const n = [...nav.walkable].filter((c) => c === '1').length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10000);
  });

  it('비용은 통행 가능 셀에만 8/27, 차단은 0', () => {
    nav.traversalCost.forEach((c, i) =>
      expect(nav.walkable[i] === '1' ? [8, 27] : [0]).toContain(c),
    );
  });

  it('다리·부두·그로브는 걷고 바다와 건물 footprint 는 막힌다', () => {
    const g = map.crossings;
    for (const poly of [g.dock.polygon, g.bridge.polygon, g.grove])
      expect(walkableCellsIn(poly)).toBeGreaterThan(0);
    expect(open(0, 0)).toBe(false);
    const hall = catalog.objects.find((o) => o.building === 'hall')!;
    const [[x0, y0], , [x1, y1]] = hall.footprint;
    expect(open(Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2))).toBe(false);
  });

  it('건물 7종 입구와 스폰은 걸을 수 있다', () => {
    const ids = catalog.objects.map((o) => o.building).filter(Boolean);
    expect(new Set(ids)).toEqual(
      new Set(['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop']),
    );
    expect(catalog.objects).toHaveLength(109);
    for (const c of [...Object.values(nav.entrances), nav.spawns.character])
      expect(open(c.cx, c.cy)).toBe(true);
  });

  it('두 번 생성해도, 커밋된 파일과도 바이트가 같다', () => {
    const a = build();
    expect(build()).toEqual(a);
    for (const f of Object.keys(a))
      expect(fs.readFileSync(path.join(__dirname, f), 'utf8')).toBe(a[f]);
  });

  it('.cjs 통행 판정은 villageScene() 과 96×64 에서 셀 단위로 같다', () => {
    const all = ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop'] as const;
    const { cols, rows, cells } = villageScene(all).grid;
    expect([cols, rows]).toEqual([96, 64]);
    const mine = Array.from({ length: cols * rows }, (_, i) =>
      walkableAt(i % cols, Math.floor(i / cols), cols, rows) ? '1' : '0',
    ).join('');
    expect(mine).toBe(cells);
  });

  it('roads.cells 는 roadLayers 합집합과 같고 고립 길 셀 수는 고정', () => {
    const { roads, roadLayers } = map;
    const union = roads.cells.map((_, i) => roadLayers.some((r) => r.cells[i]));
    expect(roads.cells.map(Boolean)).toEqual(union);
    const c = roads.columns;
    const isolated = roads.cells.filter(
      (on, i) =>
        on &&
        !(
          (i % c > 0 && roads.cells[i - 1]) ||
          (i % c < c - 1 && roads.cells[i + 1]) ||
          roads.cells[i - c] ||
          roads.cells[i + c]
        ),
    ).length;
    expect(isolated).toBe(9);
  });
});
