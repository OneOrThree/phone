// 렌더링·이동·로컬 방이 함께 사용하는 섬 배치. 좌석 번호는 0부터 시작한다.
export const ISLAND = {
  radiusX: 22,
  radiusZ: 20.4,
  grassRadius: 22.6,
  shoreRadius: 23.3,
} as const;
export const CAPACITY = 30;
export const ROOM_CAPACITY = 60;
export const CAMPFIRE = { x: 0, z: 0, radius: 1.7 } as const;
export const SPAWN_POINT = { x: 0, z: 12.2 } as const;
export const REST_POINT = { x: 0, z: 3.6 } as const;
export const DOCK_POINT = { x: 0, z: 24.8 } as const;
// 낚시섬은 연못과 물가 길을 가진 별도 공간이다. 바깥 해안 크기는 일반 섬과 같다.
export const FOCUS_ISLAND = {
  ...ISLAND,
  bankRadius: 11.4,
  seatRadius: 13.2,
} as const;
export const FOCUS_POND = { x: 0, z: 0, radius: 10.5 } as const;
export const FOCUS_SPAWN_POINT = { x: 0, z: 17.2 } as const;
export const FOCUS_LANDMARKS = {
  waterfall: { x: 0, z: -17.8, radius: 2 },
  gramophone: { x: 17.8, z: 0, radius: 0.8 },
  shelter: { x: -17.4, z: 0, radius: 1.5 },
} as const;
export const SEAT_SECTIONS = ["동쪽 물가", "북쪽 물가", "서쪽 물가"] as const;
export const BUILDINGS = {
  hall: { x: -12, z: -11, radius: 2.5, entrance: { x: -12, z: -7.8 } },
  shop: { x: 12, z: -9, radius: 2.5, entrance: { x: 12, z: -5.8 } },
  lighthouse: { x: 6, z: -17, radius: 1.3 },
  mailbox: { x: 14, z: 7, radius: 0.6 },
} as const;
export type FocusSeat = {
  id: number;
  x: number;
  z: number;
  yaw: number;
  ring: number;
};
export const FOCUS_SEATS: readonly FocusSeat[] = Array.from(
  { length: CAPACITY },
  (_, i) => {
    const angle = (i / CAPACITY) * Math.PI * 2 + Math.PI / CAPACITY;
    const x = Math.sin(angle) * FOCUS_ISLAND.seatRadius,
      z = Math.cos(angle) * FOCUS_ISLAND.seatRadius;
    return {
      id: i,
      x,
      z,
      yaw: Math.atan2(-x, -z),
      ring: Math.floor(i / 10),
    };
  },
);
export const getFocusSeat = (id: number) =>
  FOCUS_SEATS.find((seat) => seat.id === id);
// 연못 가운데 작은 섬. 꼭대기(flatRadius 안)는 땅과 같은 높이로 평평하고 footRadius에서 연못 바닥에 닿는다.
// 물가 길·의자 30석과 떨어진 물 한가운데라 사람이 걸어 들어갈 수 없다(world.ts의 연못 판정).
export const FOCUS_ISLET = {
  x: FOCUS_POND.x,
  z: FOCUS_POND.z,
  flatRadius: 1.8,
  footRadius: 3.15,
} as const;
// 의자에 앉은 고양이의 찌가 떨어지는 거리. 의자 앞 3.5m 수면이다(catPose.ts의 FOCUS_CAST).
export const CHAIR_CAST = 3.5;
export const castSpot = (seat: { x: number; z: number; yaw: number }) => ({
  x: seat.x + Math.sin(seat.yaw) * CHAIR_CAST,
  z: seat.z + Math.cos(seat.yaw) * CHAIR_CAST,
});
// 작은 섬에서 등을 맞대고 앉아 바깥 연못에 낚싯대를 드리운 집중 친구 자리. 화면에서만 사는 친구라
// 사용자 의자(FOCUS_SEATS)·예약·서버 검증·자리 고르기 목록에 들어가지 않는다. 0번은 부두 쪽(남)을 본다.
export type FriendSeat = { x: number; z: number; yaw: number };
export const FRIEND_SEAT_RADIUS = 0.95;
export const FRIEND_SEATS: readonly FriendSeat[] = [0, 1, 2].map((i) => {
  const yaw = (i / 3) * Math.PI * 2;
  return {
    x: FOCUS_ISLET.x + Math.sin(yaw) * FRIEND_SEAT_RADIUS,
    z: FOCUS_ISLET.z + Math.cos(yaw) * FRIEND_SEAT_RADIUS,
    yaw,
  };
});
export const TREE_POSITIONS: [number, number, number][] = Array.from(
  { length: 30 },
  (_, i): [number, number, number] => {
    const angle = (i / 30) * Math.PI * 2;
    return [
      Math.sin(angle) * (19.1 + (i % 3) * 0.35),
      Math.cos(angle) * (17.4 + (i % 2) * 0.5),
      1.15 + (i % 4) * 0.14,
    ];
  },
).filter(([x, z]) => Math.abs(x) > 2 || z < 0);
export const FOCUS_TREE_POSITIONS: [number, number, number][] = Array.from(
  { length: 26 },
  (_, i): [number, number, number] => {
    const angle = (i / 26) * Math.PI * 2;
    return [Math.sin(angle) * 19.5, Math.cos(angle) * 17.9, 1 + (i % 3) * 0.12];
  },
).filter(([x, z]) => Math.abs(x) > 3 && Math.abs(z) > 3);
