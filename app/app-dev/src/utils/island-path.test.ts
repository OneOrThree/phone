import assert from 'node:assert/strict';
import {
  nodes,
  walkPath,
  distance,
  nearestPoint,
  isWalkable,
  touchDestination,
  clearSegment,
} from '@/utils/island-path';
test('모든 시설 입구까지 길을 따라 도달한다', () => {
  for (const from of Object.values(nodes))
    for (const to of Object.values(nodes)) {
      const p = walkPath(from, to);
      assert.ok(distance(p[0], from) < 1);
      assert.ok(distance(p.at(-1)!, to) < 1);
      assert.ok(p.every((x) => Number.isFinite(x.x) && Number.isFinite(x.y)));
    }
});
test('이동 도중 목적지를 바꾸어도 현재 위치에서 출발한다', () => {
  const mid = { x: 518, y: 990 };
  const p = walkPath(mid, nodes.hall);
  assert.deepEqual(p[0], mid);
  assert.deepEqual(p.at(-1), nodes.hall);
});
test('섬 밖의 탭은 가장 가까운 길로 보정된다', () => {
  const q = nearestPoint({ x: -100, y: 2200 });
  assert.ok(q.x >= 0 && q.x <= 1024 && q.y <= 1536);
  assert.ok(distance(q, { x: -100, y: 2200 }) > 0);
});

test('풀밭의 목적지를 길 중앙으로 강제 이동시키지 않는다', () => {
  for (const p of [
    { x: 70, y: 800 },
    { x: 1150, y: 760 },
    { x: 545, y: 655 },
  ]) {
    assert.ok(isWalkable(p));
    assert.deepEqual(touchDestination(p), p);
    const path = walkPath(nodes.dock, p);
    assert.deepEqual(path.at(-1), p);
    for (let i = 1; i < path.length; i++) assert.ok(clearSegment(path[i - 1], path[i]));
  }
});
test('새 경로는 건물과 모닥불을 통과하지 않고 시설 입구에 도착한다', () => {
  for (const from of Object.values(nodes))
    for (const to of Object.values(nodes)) {
      const path = walkPath(from, to);
      for (let i = 1; i < path.length; i++)
        assert.ok(clearSegment(path[i - 1], path[i]), JSON.stringify({ from, to, path }));
    }
});
test('바다 탭 무시·시설 충돌·건설 전 빈 자리 이동', () => {
  assert.equal(touchDestination({ x: -650, y: 400 }), null);
  assert.equal(isWalkable({ x: 780, y: 900 }), false);
  assert.equal(isWalkable({ x: 780, y: 900 }, []), true);
  const p = { x: 510, y: 765 };
  assert.equal(isWalkable(p, []), false);
});
test('연속 목적지 변경에서도 현재 발 위치를 유지한다', () => {
  const first = walkPath(nodes.dock, nodes.tower);
  for (let i = 1; i < first.length; i++) {
    const mid = {
      x: (first[i - 1].x + first[i].x) / 2,
      y: (first[i - 1].y + first[i].y) / 2,
    };
    const second = walkPath(mid, { x: 70, y: 800 });
    assert.deepEqual(second[0], mid);
    assert.deepEqual(second.at(-1), { x: 70, y: 800 });
    for (let j = 1; j < second.length; j++) assert.ok(clearSegment(second[j - 1], second[j]));
  }
});

test('해안 밖의 저장 위치를 복원해도 바다에서 출발하지 않는다', () => {
  for (const from of [
    { x: 1600, y: 1400 },
    { x: -500, y: 1200 },
    { x: 420, y: 1600 },
  ]) {
    const path = walkPath(from, nodes.hall);
    assert.ok(path.every((p) => isWalkable(p)));
    assert.deepEqual(path.at(-1), nodes.hall);
    for (let i = 1; i < path.length; i++) assert.ok(clearSegment(path[i - 1], path[i]));
  }
});
test('해안·숲 바깥의 탭은 가까워도 이동을 시작하지 않는다', () => {
  for (let x = -300; x <= 1500; x += 60)
    for (let y = 200; y <= 1500; y += 60) {
      const p = { x, y },
        dest = touchDestination(p);
      if (!isWalkable(p)) assert.equal(dest, null);
      else assert.deepEqual(dest, p);
    }
});
