import { applyLayout, legacyLayoutOffsets } from './island-layout';
import { villageMap } from './village-world';

describe('applyLayout', () => {
  const bundle = { kind: 'bundle' } as const;
  const objects = villageMap.objects;

  it('layout 이 없으면 같은 배열을 그대로 돌려준다', () => {
    expect(applyLayout(objects, undefined, bundle)).toBe(objects);
    expect(applyLayout(objects, { schemaVersion: 1, mapId: 'home', buildings: [] }, bundle)).toBe(
      objects,
    );
  });

  it('건물 cell 중심을 이미지 px 발밑으로 덮어쓰고 나머지는 건드리지 않는다', () => {
    const out = applyLayout(
      objects,
      {
        schemaVersion: 1,
        mapId: 'home',
        buildings: [{ id: 'hall', cell: { x: 71, y: 31 }, anchor: 'bottom-center' }],
      },
      bundle,
    );
    const hall = out.find((o) => o.building === 'hall')!;
    expect(hall.x).toBeCloseTo(1098.24, 6);
    expect(hall.y).toBeCloseTo(322.56, 6);
    const library = out.find((o) => o.building === 'library');
    expect(library).toBe(objects.find((o) => o.building === 'library'));
    expect(out.filter((o, i) => o !== objects[i])).toHaveLength(1);
  });

  it.each([
    ['schemaVersion 2', { schemaVersion: 2, mapId: 'home', cell: { x: 71, y: 31 } }],
    ['mapId 다름', { schemaVersion: 1, mapId: 'other', cell: { x: 71, y: 31 } }],
    ['cell 범위 밖', { schemaVersion: 1, mapId: 'home', cell: { x: 100, y: 31 } }],
    ['cell NaN', { schemaVersion: 1, mapId: 'home', cell: { x: NaN, y: 31 } }],
  ])('%s 이면 서버 배치를 무시하고 입력을 그대로 돌려준다', (_name, { cell, ...head }) => {
    const layout = { ...head, buildings: [{ id: 'hall' as const, cell }] };
    expect(applyLayout(objects, layout, bundle)).toBe(objects);
  });
});

describe('legacyLayoutOffsets', () => {
  // 서버 기본 템플릿 — placement.json rect 발밑에서 유도한 셀과 같다.
  const defaults = {
    hall: { x: 69, y: 25 },
    board: { x: 58, y: 23 },
    gram: { x: 23, y: 46 },
    library: { x: 80, y: 59 },
    mail: { x: 20, y: 56 },
    tower: { x: 13, y: 21 },
    shop: { x: 38, y: 76 },
  } as const;
  const layoutOf = (cells: Partial<Record<keyof typeof defaults, { x: number; y: number }>>) => ({
    schemaVersion: 1,
    mapId: 'home',
    buildings: Object.entries(cells).map(([id, cell]) => ({
      id: id as keyof typeof defaults,
      cell,
    })),
  });

  it('기본 템플릿이면 모든 건물 이동량이 정확히 0', () => {
    const out = legacyLayoutOffsets(layoutOf(defaults));
    expect(Object.keys(out)).toHaveLength(7);
    for (const o of Object.values(out)) expect(o).toEqual({ x: 0, y: 0 });
  });

  it('옮긴 셀은 셀 차 × (15.36, 10.24) px 만큼 이동한다', () => {
    const out = legacyLayoutOffsets(layoutOf({ ...defaults, hall: { x: 71, y: 31 } }));
    expect(out.hall!.x).toBeCloseTo(2 * 15.36, 6);
    expect(out.hall!.y).toBeCloseTo(6 * 10.24, 6);
    expect(out.shop).toEqual({ x: 0, y: 0 });
  });

  it.each([
    ['layout 없음', undefined],
    ['schemaVersion 2', { ...layoutOf({ hall: { x: 71, y: 31 } }), schemaVersion: 2 }],
    ['mapId 다름', { ...layoutOf({ hall: { x: 71, y: 31 } }), mapId: 'other' }],
    ['cell 범위 밖', layoutOf({ hall: { x: 100, y: 31 } })],
  ])('%s 이면 이동 없음(빈 객체)', (_name, layout) => {
    expect(legacyLayoutOffsets(layout)).toEqual({});
  });
});
