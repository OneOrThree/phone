import assert from 'node:assert/strict';
import { landPath, onLand } from '@/utils/world-grid';
import {
  LANDING,
  PEER_SPOTS,
  anchorCard,
  castSpot,
  fishingCamera,
  fishingGrid,
  occupied,
} from '@/screens/focus/FishingIsland';

test('낚시섬: 물은 누를 수 없고, 뗏목 옆 땅에서 누른 땅까지 걸어갈 수 있다', () => {
  assert.equal(onLand(fishingGrid, { x: 2, y: 2 }), false); // 바다
  assert.equal(onLand(fishingGrid, { x: 40, y: 40 }), false); // 연못
  assert.ok(onLand(fishingGrid, LANDING));
  for (const p of [{ x: 34.1, y: 55.9 }, ...PEER_SPOTS])
    assert.ok(landPath(fishingGrid, LANDING, p).length > 1, `${p.x},${p.y}`);
});

test('앉은 자리에서 가까운 물 쪽으로 낚싯줄을 던진다', () => {
  // 시안 예시 내 자리 [34.1, 55.9, -1, 33.1, 55.1]
  const spot = castSpot({ x: 34.1, y: 55.9 });
  assert.equal(spot.face, -1);
  assert.ok(Math.hypot(spot.bx! - 33.1, spot.by! - 55.1) < 1.5);
  assert.equal(onLand(fishingGrid, { x: spot.bx!, y: spot.by! }), false);
});

test('물가 칸 경계 바로 안쪽 땅을 눌러도 앉는 자리는 땅이다(반올림으로 물 칸이 되지 않음)', () => {
  const { cols, cells } = fishingGrid;
  let checked = 0;
  for (let c = 0; c < cells.length - 1; c++) {
    // 오른쪽 이웃이 물인 땅 칸의 오른쪽 경계 0.04% 안쪽
    if (c % cols === cols - 1 || cells[c] !== '1' || cells[c + 1] !== '0') continue;
    const p = { x: ((c % cols) + 1) * 2 - 0.04, y: (Math.floor(c / cols) + 0.5) * 2 };
    assert.ok(onLand(fishingGrid, p));
    const spot = castSpot(p);
    assert.ok(onLand(fishingGrid, spot), `${p.x},${p.y}`);
    checked++;
  }
  assert.ok(checked > 10);
});

test('다른 주민 자리 가까이는 앉을 수 없다', () => {
  assert.ok(occupied({ x: PEER_SPOTS[0].x + 2, y: PEER_SPOTS[0].y }, PEER_SPOTS));
  assert.ok(!occupied({ x: 34.1, y: 55.9 }, PEER_SPOTS.slice(0, 2)));
});

test('집중 준비 카드: 가로 402 높이에 키보드(약 240)가 떠도 버튼이 보이게 위로 올린다', () => {
  // 가로 화면, 남은 높이 162, 카드 높이 180: 아래가 화면 안(버튼 보임)
  const tight = anchorCard(300, 150, 67, 330, 180, 874, 162);
  assert.ok(tight.top + 180 <= 162 - 8);
  // 여유가 있으면 고양이 위에 붙는다
  const roomy = anchorCard(201, 600, 49, 330, 170, 402, 874);
  assert.equal(roomy.top, 600 - 49 - 10 - 170);
});

test('지도 창: 세로는 폭 640 지도를 가운데 높이에, 가로는 화면 폭 지도를 세로로 스크롤', () => {
  const port = fishingCamera(402, 874, 1, { x: 34.1, y: 55.9 });
  assert.equal(port.size, 640);
  assert.equal(port.sx, 17);
  assert.equal(port.sy, 0);
  assert.ok(Math.abs(port.top - (874 - 640 / 1.5) / 2) < 0.01);
  const land = fishingCamera(874, 402, 1, { x: 34.1, y: 55.9 });
  assert.equal(land.sx, 0);
  assert.equal(land.sy, Math.round(583 * 0.559 - 201));
  // 확대해도 보는 곳은 화면 가운데에 남는다
  const zoom = fishingCamera(402, 874, 1.4, { x: 34.1, y: 55.9 });
  assert.ok(Math.abs(zoom.left + zoom.size * 0.341 - 201) <= 1);
  // 가로에서 0.8배로 줄여 지도가 화면보다 좁으면 가로 가운데
  const far = fishingCamera(874, 402, 0.8, { x: 10, y: 55.9 });
  assert.ok(Math.abs(far.left - (874 - far.size) / 2) <= 0.5);
});
