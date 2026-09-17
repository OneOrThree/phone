import assert from 'node:assert/strict';
import { IslandCamera } from '@/utils/island-camera';
test('reference zoom bounds reveal the whole 2560px island and cap close-up at 2.4x', () => {
  const c = new IslandCamera();
  c.resize(402, 874);
  assert.equal(c.scale, 402 / 1024);
  c.zoom(0.0001, { x: 201, y: 437 });
  assert.equal(c.scale, c.minScale);
  assert(c.screen({ x: 0, y: 768 }).x >= 0);
  assert(c.screen({ x: 2560, y: 768 }).x <= 402);
  assert.deepEqual(c.center, { x: 1280, y: 768 });
  c.zoom(100, { x: 201, y: 437 });
  assert.equal(c.scale, c.maxScale);
});
test('pinch keeps its world anchor under the moving midpoint', () => {
  const c = new IslandCamera();
  c.resize(402, 874);
  const point = { x: 180, y: 430 },
    anchor = c.world(point),
    next = { x: 200, y: 440 };
  c.zoom(c.scale * 1.5, next, anchor);
  const actual = c.screen(anchor);
  assert(Math.abs(actual.x - next.x) < 0.00001);
  assert(Math.abs(actual.y - next.y) < 0.00001);
});
test('drag reaches both coasts, clamps overdrag and keeps small maps centered', () => {
  const c = new IslandCamera();
  c.pan(10000, 10000);
  assert.equal(c.center.x, 512 - 80);
  assert.equal(c.center.y, 768);
  c.pan(-20000, -20000);
  assert.equal(c.center.x, 2560 - 512 + 80);
  c.zoom(c.minScale, { x: 201, y: 437 });
  c.pan(10000, 10000);
  assert.deepEqual(c.center, { x: 1280, y: 768 });
});
test('resizing preserves relative zoom and inverse world/screen coordinates', () => {
  const c = new IslandCamera();
  c.zoom(c.defaultScale * 1.7, { x: 201, y: 437 });
  c.resize(800, 400);
  assert(Math.abs(c.scale / c.defaultScale - 1.7) < 0.00001);
  const p = { x: 1140, y: 830 };
  const q = c.world(c.screen(p));
  assert(Math.abs(p.x - q.x) < 0.00001);
  assert(Math.abs(p.y - q.y) < 0.00001);
});
test("portrait to landscape and back preserves the user's relative zoom", () => {
  const c = new IslandCamera();
  c.resize(402, 874);
  c.resize(874, 402);
  assert.equal(c.scale, c.defaultScale);
  assert(c.scale >= c.minScale);
  c.resize(402, 874);
  assert.equal(c.scale, 402 / 1024);
});
