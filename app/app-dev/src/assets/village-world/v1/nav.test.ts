import fs from 'node:fs';
import path from 'node:path';
import map from '../map.json';
import home from './home.map.json';
import nav from './nav.json';
import catalog from './objects.json';
import { villageScene } from '@/utils/village-world';
const { build, walkableAt, openAtPx, center } = require('../../../../scripts/build-nav-fixture.cjs');

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
  it('objects.json 이 오브젝트별 w·h·asset 을 원본 map.json 과 같게 보존한다(tree 9 vs 12)', () => {
    const byId = (list: { id: number }[], id: number) => list.find((o) => o.id === id) as never;
    for (const id of [9, 12]) {
      const c = byId(catalog.objects, id) as { w: number; h: number; asset: string };
      const m = byId(map.objects, id) as { w: number; h: number; asset: string };
      expect([c.w, c.h, c.asset]).toEqual([m.w, m.h, m.asset]);
    }
    expect((byId(catalog.objects, 9) as { w: number }).w).not.toBe(
      (byId(catalog.objects, 12) as { w: number }).w,
    );
  });

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

  it('간선 중점이 막힌 인접 통행 셀 쌍은 2 로 고정(입구 셀 예외는 후속 티켓)', () => {
    let n = 0;
    for (let cy = 0; cy < 100; cy++)
      for (let cx = 0; cx < 100; cx++) {
        if (!open(cx, cy)) continue;
        const a = center(cx, cy);
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ]) {
          if (cx + dx > 99 || cy + dy > 99 || !open(cx + dx, cy + dy)) continue;
          const b = center(cx + dx, cy + dy);
          if (!openAtPx({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) n++;
        }
      }
    expect(n).toBe(2);
  });

  it('anchor(world) → px 복원 오차는 0.01 px 이하', () => {
    const byId = new Map(map.objects.map((o) => [o.id, o]));
    for (const c of catalog.objects) {
      const o = byId.get(c.id)!;
      expect(Math.abs(c.anchor.x * 15.36 - o.x)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(c.anchor.y * 10.24 - o.y)).toBeLessThanOrEqual(0.01);
    }
  });
});
