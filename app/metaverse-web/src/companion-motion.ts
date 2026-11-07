import { Simulation } from "./simulation";
import {
  pathTo,
  type Actor,
  type CatColor,
  type IslandId,
  type Point,
} from "./world";

type Route = { name: string; color: CatColor; points: Point[] };
export const COMPANION_ROUTES: Record<IslandId, Route[]> = {
  home: [
    { name: "안내 고양이", color: "peach", points: [{ x: -2.4, z: 14.2 }] },
    {
      name: "모카",
      color: "brown",
      points: [
        { x: -7, z: 8 },
        { x: -9, z: 2 },
        { x: -8, z: -5 },
        { x: -3, z: -5 },
        { x: -4, z: 4 },
      ],
    },
    {
      name: "구름",
      color: "white",
      points: [
        { x: 7, z: 9 },
        { x: 10, z: 3 },
        { x: 8, z: -3 },
        { x: 4, z: 4 },
      ],
    },
  ],
  focus: [
    { name: "안내 고양이", color: "peach", points: [{ x: -2.4, z: 17.4 }] },
    {
      name: "모카",
      color: "brown",
      points: [
        { x: -5, z: 15 },
        { x: -11, z: 10 },
        { x: -15, z: 3 },
        { x: -14, z: -5 },
      ],
    },
    {
      name: "구름",
      color: "white",
      points: [
        { x: 5, z: 15 },
        { x: 11, z: 9 },
        { x: 15, z: 4 },
        { x: 15, z: -5 },
      ],
    },
  ],
};

// 장면 안에서만 사는 산책 친구. 방 접속·좌석 예약·집중 시간에는 참여하지 않는다.
export class IslandCompanions {
  private friends;
  readonly actors: Actor[];
  constructor(island: IslandId) {
    this.friends = COMPANION_ROUTES[island].map((route, i) => {
      const sim = new Simulation();
      Object.assign(sim.actor, route.points[0], {
        island,
        name: route.name,
        color: route.color,
        yaw: 0.7,
        action: "sit",
      });
      // 고정 경로는 섬을 열 때 한 번만 찾는다. 프레임마다 경로를 계산하지 않는다.
      const paths =
        route.points.length === 1
          ? []
          : route.points.map((from, j) =>
              pathTo(from, route.points[(j + 1) % route.points.length], island),
            );
      return {
        sim,
        paths,
        segment: 0,
        wait: 2 + i * 2,
        greeting: 0,
        near: false,
      };
    });
    this.actors = this.friends.map(({ sim }) => sim.actor);
  }

  step(delta: number, visitor: Point, reduced: boolean) {
    const dt = Math.min(Math.max(delta, 0), 0.05);
    for (const friend of this.friends) {
      const { sim } = friend;
      if (reduced) {
        sim.actor.action = "sit";
        continue;
      }
      const distance = Math.hypot(
        visitor.x - sim.actor.x,
        visitor.z - sim.actor.z,
      );
      if (distance > 4) friend.near = false;
      if (!friend.near && distance < 2.8) {
        friend.near = true;
        friend.greeting = 2.4;
      }
      if (friend.greeting > 0) {
        friend.greeting -= dt;
        sim.actor.action = "wave";
        sim.actor.yaw = Math.atan2(
          visitor.x - sim.actor.x,
          visitor.z - sim.actor.z,
        );
        continue;
      }
      if (sim.path.length) {
        sim.step(dt * 0.45, 0, 0);
        continue;
      }
      sim.actor.action = "sit";
      friend.wait -= dt;
      if (friend.wait > 0 || !friend.paths.length) continue;
      sim.path = friend.paths[friend.segment].map((point) => ({ ...point }));
      sim.arrival = "idle";
      friend.segment = (friend.segment + 1) % friend.paths.length;
      friend.wait = 4;
    }
  }
}
