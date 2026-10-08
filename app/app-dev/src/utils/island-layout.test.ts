import { applyLayout } from './island-layout';
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
