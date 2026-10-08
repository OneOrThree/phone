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
});
