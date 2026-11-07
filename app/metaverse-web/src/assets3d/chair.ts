import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  LatheGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from "three";
import { Builder, roundedBox } from "./geometry";
import { material, SEAT_HEIGHT } from "./palette";

// 낚시 의자. 원점은 좌판 중심 아래 땅, 앞(+Z)이 연못을 본다. 오른쪽에 미끼 양동이를 둔다.
// 쿠션 윗면이 SEAT_HEIGHT(0.46)에 오도록 맞췄다.
export const CHAIR = {
  seatTop: SEAT_HEIGHT,
  boardTop: SEAT_HEIGHT - 0.055,
  width: 0.8,
  depth: 0.7,
} as const;

let frame: ReturnType<Builder["build"]> | null = null;
export function chairFrameGeometry() {
  if (frame) return frame;
  const b = new Builder(41);
  const { boardTop } = CHAIR;
  const leg = new CylinderGeometry(0.036, 0.046, boardTop - 0.06, 8);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      b.add(leg, {
        at: [sx * 0.31, (boardTop - 0.06) / 2, sz * 0.25],
        rot: [sz * 0.05, 0, -sx * 0.05],
        color: material.woodDark,
        jitter: 0.04,
      });
  // 다리 사이 가로대
  const bar = new CylinderGeometry(0.018, 0.018, 0.58, 6);
  for (const sz of [-1, 1])
    b.add(bar, {
      at: [0, 0.13, sz * 0.255],
      rot: [0, 0, Math.PI / 2],
      color: material.wood,
    });
  for (const sx of [-1, 1])
    b.add(new CylinderGeometry(0.018, 0.018, 0.48, 6), {
      at: [sx * 0.315, 0.16, 0],
      rot: [Math.PI / 2, 0, 0],
      color: material.wood,
    });
  // 좌판: 판자 세 장을 살짝 다른 색으로 붙인다.
  for (let i = 0; i < 3; i++)
    b.add(roundedBox(0.78, 0.07, 0.22, 0.025), {
      at: [0, boardTop - 0.035, -0.23 + i * 0.23],
      color: material.wood,
      jitter: 0.06,
    });
  b.add(roundedBox(0.8, 0.04, 0.05, 0.015), {
    at: [0, boardTop - 0.08, 0.31],
    color: material.woodDark,
  });
  // 등받이 기둥
  const postHeight = 0.62;
  for (const sx of [-1, 1]) {
    b.add(new CylinderGeometry(0.038, 0.042, postHeight, 8), {
      at: [sx * 0.31, boardTop + postHeight / 2 - 0.02, -0.29],
      rot: [-0.12, 0, 0],
      color: material.woodDark,
    });
    b.add(new SphereGeometry(0.052, 10, 8), {
      at: [sx * 0.31, boardTop + postHeight - 0.02, -0.33],
      color: material.woodLight,
    });
  }
  // 등받이 살과 둥근 위 가로대
  for (const x of [-0.15, 0, 0.15])
    b.add(roundedBox(0.075, 0.36, 0.03, 0.012), {
      at: [x, boardTop + 0.27, -0.31],
      rot: [-0.12, 0, 0],
      color: material.woodLight,
      jitter: 0.05,
    });
  b.add(roundedBox(0.72, 0.13, 0.055, 0.03), {
    at: [0, boardTop + 0.5, -0.34],
    rot: [-0.12, 0, 0],
    color: material.wood,
  });
  b.add(roundedBox(0.66, 0.035, 0.05, 0.012), {
    at: [0, boardTop + 0.08, -0.3],
    rot: [-0.12, 0, 0],
    color: material.woodDark,
  });
  // 등받이 앞면의 작은 물고기 장식
  b.add(new SphereGeometry(0.06, 12, 8), {
    at: [-0.02, boardTop + 0.505, -0.305],
    scale: [1.35, 0.62, 0.35],
    rot: [-0.12, 0, 0],
    color: material.cushionPending,
  });
  b.add(new ConeGeometry(0.045, 0.07, 3), {
    at: [0.085, boardTop + 0.505, -0.305],
    rot: [-0.12, 0, -Math.PI / 2],
    scale: [1, 1, 0.35],
    color: material.cushionPending,
  });
  // 의자 오른쪽 미끼 양동이와 뜰채 손잡이(옆 의자와 1.5m 넘게 떨어진다)
  const bucket = new LatheGeometry(
    [
      new Vector2(0.001, 0),
      new Vector2(0.12, 0),
      new Vector2(0.15, 0.24),
      new Vector2(0.14, 0.24),
      new Vector2(0.11, 0.02),
    ],
    14,
  );
  b.add(bucket, { at: [0.6, 0, 0.12], color: material.teal });
  for (const y of [0.06, 0.19])
    b.add(new TorusGeometry(0.125 + y * 0.11, 0.01, 4, 16), {
      at: [0.6, y, 0.12],
      rot: [Math.PI / 2, 0, 0],
      color: material.tealDark,
    });
  b.add(new TorusGeometry(0.13, 0.008, 4, 12, Math.PI), {
    at: [0.6, 0.24, 0.12],
    rot: [0, 0.4, 0],
    color: material.stoneDark,
  });
  frame = b.build();
  return frame;
}

let cushion: ReturnType<Builder["build"]> | null = null;
export function chairCushionGeometry() {
  if (cushion) return cushion;
  const b = new Builder(43);
  b.add(roundedBox(0.68, 0.058, 0.6, 0.028, 3), {
    at: [0, CHAIR.boardTop + 0.027, 0.01],
    color: "#ffffff",
  });
  // 쿠션 가운데 단추
  b.add(new SphereGeometry(0.03, 8, 6), {
    at: [0, CHAIR.seatTop - 0.012, 0.01],
    scale: [1, 0.45, 1],
    color: "#e9e1d6",
  });
  cushion = b.build();
  return cushion;
}

// 클릭 범위. 의자와 앉은 고양이 아랫부분을 덮는 보이지 않는 상자.
let hit: BoxGeometry | null = null;
export function chairHitGeometry() {
  hit ??= new BoxGeometry(0.98, 1.2, 0.96).translate(0, 0.6, -0.02);
  return hit;
}

let ring: RingGeometry | null = null;
export function seatRingGeometry() {
  ring ??= new RingGeometry(0.6, 0.74, 48).rotateX(-Math.PI / 2);
  return ring;
}
