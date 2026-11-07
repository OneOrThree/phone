import { FishingRhythm, CATCH_LENGTH } from "./fishing-rhythm";
import { FRIEND_SEATS } from "./layout";
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

// 낚시섬 가운데 작은 섬에서 의자에 앉아 집중하는 친구. 산책 친구와 이름·털색이 겹치지 않는다.
export const FOCUS_FRIENDS: { name: string; color: CatColor }[] = [
  { name: "보리", color: "cream" },
  { name: "까미", color: "black" },
  { name: "단비", color: "gray" },
];
// 집중 친구는 같은 33초 박자를 11초씩 어긋나게 낚는다. 한 번이 7초라 둘이 함께 낚는 일이 없고,
// 섬에 들어서고 2.5초 뒤 첫 물고기가 올라온다.
export const FRIEND_FISHING_EVERY = 33;
export const FRIEND_FISHING_OFFSET =
  FRIEND_FISHING_EVERY / FOCUS_FRIENDS.length;
const friendRhythm = (i: number) => {
  const first = 2.5 + i * FRIEND_FISHING_OFFSET;
  const gap = FRIEND_FISHING_EVERY - CATCH_LENGTH;
  return new FishingRhythm({ first: [first, first], gap: [gap, gap] });
};
export type FocusFriend = { actor: Actor; fishing: FishingRhythm };

// 장면 안에서만 사는 친구. 방 접속·좌석 예약·집중 시간에는 참여하지 않는다.
// 산책 친구는 정해진 길을 돌고, 낚시섬의 집중 친구는 작은 섬의 전용 의자에서 움직이지 않는다.
export class IslandCompanions {
  private friends;
  readonly actors: Actor[];
  readonly sitters: FocusFriend[];
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
    this.sitters =
      island === "focus"
        ? FOCUS_FRIENDS.map((friend, i) => ({
            actor: {
              x: FRIEND_SEATS[i].x,
              z: FRIEND_SEATS[i].z,
              yaw: FRIEND_SEATS[i].yaw,
              island,
              name: friend.name,
              color: friend.color,
              action: "focus",
            },
            fishing: friendRhythm(i),
          }))
        : [];
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
