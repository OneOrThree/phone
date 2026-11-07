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
