import test from "node:test";
import assert from "node:assert/strict";
import { COMPANION_ROUTES, IslandCompanions } from "../src/companion-motion";
import { pathTo, walkable, type IslandId } from "../src/world";

for (const island of ["home", "focus"] as IslandId[]) {
  test(`${island} 봇은 지형 위 산책로를 돌고 낚시 의자를 쓰지 않는다`, () => {
    for (const { points } of COMPANION_ROUTES[island]) {
      for (let i = 0; i < points.length; i++) {
        assert.ok(walkable(points[i], island));
        if (points.length > 1)
          assert.ok(
            pathTo(points[i], points[(i + 1) % points.length], island).length,
          );
      }
    }
    const friends = new IslandCompanions(island);
    const starts = friends.actors.map((a) => ({ x: a.x, z: a.z }));
    let walked = false;
    for (let frame = 0; frame < 60 * 180; frame++) {
      friends.step(1 / 60, { x: 100, z: 100 }, false);
      for (const actor of friends.actors) {
        assert.ok(walkable(actor, island));
        assert.equal(actor.seatId, undefined);
        assert.notEqual(actor.action, "focus");
        if (actor.action === "walk") walked = true;
      }
    }
    assert.ok(walked);
    assert.ok(
      friends.actors.some(
        (a, i) => Math.hypot(a.x - starts[i].x, a.z - starts[i].z) > 1,
      ),
    );
  });
}
test("가까이 오면 한 번 인사하고 동작 줄이기에서는 모두 멈춘다", () => {
  const friends = new IslandCompanions("home"),
    guide = friends.actors[0];
  friends.step(0.05, guide, false);
  assert.equal(guide.action, "wave");
  for (let i = 0; i < 60; i++) friends.step(0.05, guide, false);
  assert.equal(guide.action, "sit");
  const positions = friends.actors.map((a) => ({ x: a.x, z: a.z }));
  for (let i = 0; i < 120; i++) friends.step(0.05, { x: 100, z: 100 }, true);
  assert.deepEqual(
    friends.actors.map((a) => ({ x: a.x, z: a.z })),
    positions,
  );
  assert.ok(friends.actors.every((a) => a.action === "sit"));
});
