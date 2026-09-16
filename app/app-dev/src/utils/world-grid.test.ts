import assert from 'node:assert/strict';
import grids from '@/constants/world-v2.json';
import { onLand, landPath, nearestLand } from '@/utils/world-grid';
test('6번 섬: 모든 시설과 별도 전망대 섬까지 실제 걸을 수 있는 경로로 연결', () => {
  for (const [x, y] of [
    [1030, 268],
    [891, 250],
    [380, 485],
    [1190, 612],
    [320, 596],
    [272, 200],
    [577, 783],
    [274, 740],
  ]) {
    const path = landPath(grids.home, { x: 585, y: 470 }, nearestLand(grids.home, { x, y }));
    assert.ok(path.length > 1, `entrance ${x},${y}`);
    assert.ok(path.every((p) => onLand(grids.home, p)));
  }
});
test('바다·연못은 선택하지 않고 낚시섬의 임의의 땅으로 이동', () => {
  assert.equal(onLand(grids.fishing, { x: 5, y: 5 }), false);
  assert.deepEqual(landPath(grids.fishing, { x: 340, y: 1130 }, { x: 5, y: 5 }), []);
  for (const p of [
    { x: 350, y: 830 },
    { x: 512, y: 840 },
    { x: 550, y: 850 },
  ])
    assert.ok(landPath(grids.fishing, { x: 340, y: 1130 }, p).length > 1);
});
