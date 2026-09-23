import { villageScene, villageMap, villageDoors, villagePath } from './village-world';
import { onLand, nearestLand } from './world-grid';
import type { Building } from '@/services/model';
const all: Building[] = ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop'];
const origin = { x: 820, y: 535 };

test('지은 시설만 그림·샛길·충돌에 포함한다', () => {
  const empty = villageScene([]),
    partial = villageScene(['hall']);
  expect(empty.objects.filter((o) => o.building)).toHaveLength(0);
  expect(empty.roads).toHaveLength(1);
  expect(partial.objects.filter((o) => o.building).map((o) => o.building)).toEqual(['hall']);
  expect(partial.roads.map((r) => r.building)).toEqual([null, 'hall']);
  const hall = villageMap.objects.find((o) => o.building === 'hall')!;
  expect(onLand(empty.grid, { x: hall.x, y: hall.y - 20 })).toBe(true);
  expect(onLand(partial.grid, { x: hall.x, y: hall.y - 20 })).toBe(false);
});

test('모든 건물 문·부두·다리 건너 섬까지 장애물 없이 도달한다', () => {
  const scene = villageScene(all);
  const [x, y] = villageMap.crossings.dock.arrival;
  for (const target of [...Object.values(villageDoors), { x, y }, { x: 200, y: 170 }]) {
    const path = villagePath(scene, origin, target);
    if (path.length < 2) throw new Error('연결되지 않은 목적지: ' + JSON.stringify(target));
    expect(path.at(-1)).toEqual(nearestLand(scene.grid, target));
    expect(path.every((p) => onLand(scene.grid, p))).toBe(true);
    for (let i = 1; i < path.length; i++) {
      if (path[i].x !== path[i - 1].x && path[i].y !== path[i - 1].y) {
        expect(onLand(scene.grid, { x: path[i].x, y: path[i - 1].y })).toBe(true);
        expect(onLand(scene.grid, { x: path[i - 1].x, y: path[i].y })).toBe(true);
      }
    }
  }
});

test('건물 조합이 달라도 부두와 해당 시설의 진입 동선이 연결된다', () => {
  for (const buildings of [
    [],
    ['hall'],
    ['library'],
    ['shop'],
    ['tower', 'mail'],
  ] as Building[][]) {
    const scene = villageScene(buildings);
    const [x, y] = villageMap.crossings.dock.arrival;
    expect(villagePath(scene, origin, { x, y }).length).toBeGreaterThan(1);
    for (const b of buildings)
      expect(villagePath(scene, origin, villageDoors[b]).length).toBeGreaterThan(1);
  }
});

test('바다는 통행 영역이 아니고 비정상 목적지는 경로를 만들지 않는다', () => {
  const scene = villageScene(all);
  expect(onLand(scene.grid, { x: 20, y: 20 })).toBe(false);
  expect(villagePath(scene, origin, { x: NaN, y: 1 })).toEqual([]);
});
