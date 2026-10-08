import fs from 'node:fs';
import path from 'node:path';
import grids from '@/constants/world-v2.json';
import { onLand } from '@/utils/world-grid';
import { loadNav, navPath } from '@/utils/nav-path';
import { cellCenterToWorld, imageToWorld, worldToImage } from '@/utils/worldCoords';
import home from './home.map.json';
import nav from './nav.json';
const { build, center, edgeOpen, DOORS } = require('../../../../scripts/build-nav-fixture.cjs');

const open = (cx: number, cy: number) => nav.walkable[cy * nav.columns + cx] === '1';
const size = { imageWidth: 1536, imageHeight: 1024 };

describe('v1 nav fixture (기존 마을)', () => {
  it('스키마 모양', () => {
    expect(home).toMatchObject({
      mapId: 'home',
      coordinateVersion: 1,
      imageWidth: grids.home.w,
      imageHeight: grids.home.h,
      nav: { columns: 100, rows: 100 },
    });
    expect(home).not.toHaveProperty('objectsCatalog');
    expect(nav.walkable).toHaveLength(10000);
    expect(nav.traversalCost).toHaveLength(10000);
  });

  it('통행 셀은 셀 중심에서 onLand(grids.home) 와 같다', () => {
    let n = 0;
    for (let cy = 0; cy < 100; cy++)
      for (let cx = 0; cx < 100; cx++) {
        const p = { x: ((cx + 0.5) * 1536) / 100, y: ((cy + 0.5) * 1024) / 100 };
        expect(open(cx, cy)).toBe(onLand(grids.home, p));
        if (open(cx, cy)) n++;
      }
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10000);
    expect(open(0, 0)).toBe(false); // 바다
  });

  it('길은 원화에 그려져 비용은 전 셀 잔디 27 하나', () => {
    expect(new Set(nav.traversalCost)).toEqual(new Set([27]));
  });

  it('buildingCells 는 건물 7종 모두 빈 배열(기존 격자는 건설로 바뀌지 않는다)', () => {
    expect(nav.buildingCells).toEqual({
      hall: [],
      library: [],
      shop: [],
      tower: [],
      board: [],
      gram: [],
      mail: [],
    });
  });

  it('입구 7곳·스폰은 걸을 수 있고 스폰에서 전부 도달한다', () => {
    const g = loadNav(nav as any);
    const spawn = nav.spawns.character;
    expect(open(spawn.cx, spawn.cy)).toBe(true);
    const from = cellCenterToWorld(spawn);
    expect(Object.keys(nav.entrances).sort()).toEqual(
      ['board', 'gram', 'hall', 'library', 'mail', 'shop', 'tower'],
    );
    for (const en of Object.values(nav.entrances)) {
      expect(open(en.cx, en.cy)).toBe(true);
      const route = navPath(g, from, cellCenterToWorld(en));
      expect(route[route.length - 1]).toEqual(cellCenterToWorld(en));
    }
  });

  it('입구 셀은 원래 문 px 에서 한 셀 대각 거리 안이다', () => {
    for (const [id, d] of Object.entries(DOORS as Record<string, { x: number; y: number }>)) {
      const c = worldToImage(cellCenterToWorld((nav.entrances as any)[id]), size);
      expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeLessThan(Math.hypot(15.36, 10.24) * 2);
    }
  });

  it('스폰에서 부두 끝(뗏목 문 274,740)까지 걸어간다', () => {
    const g = loadNav(nav as any);
    const route = navPath(
      g,
      cellCenterToWorld(nav.spawns.character),
      imageToWorld({ x: 274, y: 740 }, size),
    );
    const end = worldToImage(route[route.length - 1], size);
    expect(Math.hypot(end.x - 274, end.y - 740)).toBeLessThan(20);
  });

  it('blockedEdges 는 선분 내부 31점 재계산과 같다', () => {
    const found: number[][] = [];
    for (let i = 0; i < 10000; i++) {
      const cx = i % 100,
        cy = Math.floor(i / 100);
      if (!open(cx, cy)) continue;
      if (cx < 99 && open(cx + 1, cy) && !edgeOpen(center(cx, cy), center(cx + 1, cy)))
        found.push([i, i + 1]);
      if (cy < 99 && open(cx, cy + 1) && !edgeOpen(center(cx, cy), center(cx, cy + 1)))
        found.push([i, i + 100]);
    }
    expect(found).toEqual(nav.blockedEdges);
  });

  it('두 번 생성해도, 커밋된 파일과도 바이트가 같다', () => {
    const a = build();
    expect(build()).toEqual(a);
    expect(Object.keys(a).sort()).toEqual(['home.map.json', 'nav.json']);
    for (const f of Object.keys(a))
      expect(fs.readFileSync(path.join(__dirname, f), 'utf8')).toBe(a[f]);
    expect(fs.existsSync(path.join(__dirname, 'objects.json'))).toBe(false);
  });
});
