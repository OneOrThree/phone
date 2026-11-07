import {
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  LatheGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { art } from "../theme";
import { Builder, lumpy, rng, roundedBox } from "./geometry";
import { material, SEA_LEVEL } from "./palette";
import { BOAT, DOCK } from "./site";

const memo = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key) as T;
}

// 모닥불 받침: 돌 고리, 재, 원뿔로 세운 장작. 원점은 모닥불 중심 땅.
export const campfireBase = () =>
  once("campfire", () => {
    const b = new Builder(901);
    const random = rng(902);
    b.add(new CylinderGeometry(1.22, 1.3, 0.05, 32), {
      at: [0, 0.02, 0],
      color: material.ash,
    });
    b.add(new CylinderGeometry(0.75, 0.8, 0.04, 24), {
      at: [0, 0.045, 0],
      color: "#6E625C",
    });
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * Math.PI * 2 + random() * 0.1;
      const r = 0.24 + random() * 0.09;
      b.add(lumpy(r, 1, 0.35, 910 + i), {
        at: [Math.cos(a) * 1.34, r * 0.55, Math.sin(a) * 1.34],
        rot: [0, random() * 6, 0],
        scale: [1.15, 0.85, 1],
        color: i % 4 === 0 ? material.stoneDark : material.stone,
        gradient: [0.72, 1.08],
        flat: true,
      });
    }
    // 원뿔 장작
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const lean = 0.62;
      const len = 1.3;
      const bx = Math.cos(a) * 0.62,
        bz = Math.sin(a) * 0.62;
      const cx = bx * 0.55,
        cz = bz * 0.55;
      const log = new CylinderGeometry(0.075, 0.095, len, 8);
      b.add(log, {
        at: [cx, Math.cos(lean) * len * 0.5 + 0.02, cz],
        rot: [Math.sin(a) * -lean, 0, Math.cos(a) * lean],
        color: i % 2 ? material.bark : material.woodDark,
        jitter: 0.05,
      });
    }
    // 누운 장작 두 개(나이테가 보이는 끝면)
    for (const [x, z, yaw] of [
      [0.15, 0.95, 0.3],
      [-0.85, -0.55, 2.2],
    ]) {
      b.add(new CylinderGeometry(0.12, 0.12, 0.75, 10), {
        at: [x, 0.14, z],
        rot: [Math.PI / 2, yaw, 0],
        color: material.bark,
      });
      for (const s of [-1, 1])
        b.add(new CylinderGeometry(0.105, 0.105, 0.02, 10), {
          at: [
            x + Math.sin(yaw) * 0.38 * s,
            0.14,
            z + Math.cos(yaw) * 0.38 * s,
          ],
          rot: [Math.PI / 2, yaw, 0],
          color: material.woodLight,
        });
    }
    // 숯불 덩이
    for (let i = 0; i < 9; i++) {
      const a = random() * Math.PI * 2,
        r = random() * 0.5;
      b.add(lumpy(0.09, 0, 0.3, 940 + i), {
        at: [Math.cos(a) * r, 0.07, Math.sin(a) * r],
        color: i % 2 ? "#5A4A44" : "#7E4A3A",
      });
    }
    return b.build();
  });

// 불꽃: 물방울 모양 회전체. 셰이더가 높이에 따라 일렁이게 한다.
export const flameGeometry = () =>
  once("flame", () => {
    const points: Vector2[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const r = Math.sin(Math.PI * Math.pow(t, 0.62)) * (1 - t * 0.55) * 0.5;
      points.push(new Vector2(Math.max(0.001, r), t));
    }
    return new LatheGeometry(points, 14);
  });

// 낚시 부두: 판자 바닥, 받침보, 바다에 박힌 기둥, 끝 기둥의 등과 구명 튜브, 양동이.
export const dockParts = () =>
  once("dock", () => {
    const b = new Builder(1001),
      glow = new Builder(1002);
    const random = rng(1003);
    const top = DOCK.top;
    const length = DOCK.z1 - DOCK.z0;
    const count = Math.round(length / 0.31);
    for (let i = 0; i < count; i++) {
      const z = DOCK.z0 + (i + 0.5) * (length / count);
      b.add(
        roundedBox(DOCK.x * 2 + 0.16 + random() * 0.12, 0.09, 0.28, 0.025),
        {
          at: [(random() - 0.5) * 0.08, top - 0.045, z],
          rot: [0, (random() - 0.5) * 0.03, 0],
          color: [
            material.wood,
            material.woodLight,
            material.wood,
            material.woodDark,
          ][i % 4],
          jitter: 0.08,
        },
      );
    }
    for (const x of [-1.25, 0, 1.25])
      b.add(roundedBox(0.16, 0.16, length - 0.1, 0.03), {
        at: [x, top - 0.17, (DOCK.z0 + DOCK.z1) / 2],
        color: material.woodDeep,
      });
    for (const z of DOCK.pilings)
      for (const x of [-DOCK.x, DOCK.x]) {
        const tall = z === DOCK.pilings[DOCK.pilings.length - 1] ? 0.55 : 0.3;
        const bottom = SEA_LEVEL - 2.3;
        const h = top + tall - bottom;
        b.add(new CylinderGeometry(0.13, 0.15, h, 10), {
          at: [x, bottom + h / 2, z],
          color: material.woodDark,
          gradient: [0.55, 1.05],
        });
        b.add(
          new SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
          {
            at: [x, top + tall, z],
            color: material.woodLight,
          },
        );
        b.add(new TorusGeometry(0.15, 0.03, 6, 14), {
          at: [x, top + tall - 0.16, z],
          rot: [Math.PI / 2, 0, 0],
          color: material.rope,
        });
        b.add(new TorusGeometry(0.15, 0.03, 6, 14), {
          at: [x, top + tall - 0.24, z],
          rot: [Math.PI / 2, 0, 0],
          color: material.rope,
        });
        // 물때
        b.add(new CylinderGeometry(0.155, 0.16, 0.22, 10, 1, true), {
          at: [x, SEA_LEVEL + 0.02, z],
          color: material.stoneMoss,
        });
      }
    const end = DOCK.pilings[DOCK.pilings.length - 1];
    // 끝 기둥의 등
    b.add(new CylinderGeometry(0.025, 0.025, 0.5, 5), {
      at: [DOCK.x, top + 0.8, end],
      color: material.woodDeep,
    });
    b.add(roundedBox(0.36, 0.05, 0.05, 0.015), {
      at: [DOCK.x - 0.15, top + 1.04, end],
      color: material.woodDeep,
    });
    b.add(roundedBox(0.2, 0.04, 0.2, 0.012), {
      at: [DOCK.x - 0.3, top + 0.93, end],
      color: material.woodDeep,
    });
    b.add(new ConeGeometry(0.15, 0.1, 4), {
      at: [DOCK.x - 0.3, top + 0.98, end],
      rot: [0, Math.PI / 4, 0],
      color: material.woodDeep,
    });
    glow.add(new CylinderGeometry(0.065, 0.065, 0.2, 8), {
      at: [DOCK.x - 0.3, top + 0.82, end],
      color: material.lampGlow,
    });
    b.add(roundedBox(0.18, 0.04, 0.18, 0.012), {
      at: [DOCK.x - 0.3, top + 0.71, end],
      color: material.woodDeep,
    });
    // 구명 튜브(분홍·흰 띠)
    for (let i = 0; i < 8; i++)
      b.add(new TorusGeometry(0.28, 0.075, 8, 6, Math.PI / 4), {
        at: [-DOCK.x - 0.17, top + 0.35, end - 0.05],
        rot: [0, Math.PI / 2, (i * Math.PI) / 4],
        color: i % 2 ? art.paper : art.pink,
      });
    // 양동이와 물고기 꼬리
    const bucket = new LatheGeometry(
      [
        new Vector2(0.001, 0),
        new Vector2(0.15, 0),
        new Vector2(0.19, 0.32),
        new Vector2(0.18, 0.32),
        new Vector2(0.14, 0.02),
      ],
      14,
    );
    b.add(bucket, {
      at: [-1.05, top, DOCK.z1 - 0.75],
      color: material.woodLight,
    });
    for (const y of [0.08, 0.26])
      b.add(new TorusGeometry(0.16 + y * 0.12, 0.012, 4, 16), {
        at: [-1.05, top + y, DOCK.z1 - 0.75],
        rot: [Math.PI / 2, 0, 0],
        color: material.stoneDark,
      });
    b.add(new ConeGeometry(0.07, 0.12, 3), {
      at: [-1.05, top + 0.36, DOCK.z1 - 0.72],
      rot: [0.3, 0, Math.PI],
      scale: [1.3, 1, 0.35],
      color: "#F59A6B",
    });
    // 감아 둔 밧줄
    for (let i = 0; i < 3; i++)
      b.add(new TorusGeometry(0.2 - i * 0.04, 0.035, 6, 18), {
        at: [1.1, top + 0.035 + i * 0.05, DOCK.z0 + 1.2],
        rot: [Math.PI / 2, 0, 0],
        color: material.rope,
      });
    return { solid: b.build(), glow: glow.build() };
  });

// 부두 옆에 매어 둔 작은 나룻배. 원점은 수면의 배 중심.
export const boatGeometry = () =>
  once("boat", () => {
    const b = new Builder(1101);
    const hull = new SphereGeometry(
      1,
      18,
      8,
      0,
      Math.PI * 2,
      Math.PI / 2,
      Math.PI / 2,
    );
    b.add(hull, {
      scale: [0.62, 0.5, 1.35],
      at: [0, 0.3, 0],
      color: material.teal,
      gradient: [0.7, 1.05],
    });
    b.add(hull, {
      scale: [0.56, 0.44, 1.27],
      at: [0, 0.31, 0],
      color: material.woodLight,
    });
    b.add(new TorusGeometry(1, 0.04, 6, 32), {
      at: [0, 0.31, 0],
      rot: [Math.PI / 2, 0, 0],
      scale: [0.6, 1.33, 1],
      color: material.woodDark,
    });
    b.add(roundedBox(1.05, 0.05, 0.25, 0.02), {
      at: [0, 0.2, 0.15],
      color: material.wood,
    });
    b.add(roundedBox(0.9, 0.05, 0.22, 0.02), {
      at: [0, 0.18, -0.6],
      color: material.wood,
    });
    for (const s of [-1, 1]) {
      b.add(new CylinderGeometry(0.025, 0.025, 1.5, 5), {
        at: [s * 0.22, 0.2, -0.05],
        rot: [Math.PI / 2 - 0.06, s * 0.12, 0],
        color: material.woodLight,
      });
      b.add(roundedBox(0.13, 0.02, 0.36, 0.01), {
        at: [s * 0.27, 0.19, 0.72],
        rot: [0, s * 0.12, 0],
        color: material.woodLight,
      });
    }
    return b.build();
  });

// 배와 부두 기둥을 잇는 밧줄(정적인 처짐 곡선)
export const mooringRope = () =>
  once("rope", () => {
    const from = new Vector3(BOAT.x - 0.2, SEA_LEVEL + 0.25, BOAT.z - 1.15);
    const to = new Vector3(DOCK.x + 0.1, DOCK.top + 0.08, DOCK.pilings[1]);
    const mid = from
      .clone()
      .lerp(to, 0.5)
      .add(new Vector3(0, -0.28, 0));
    return new Builder(1102)
      .add(
        new TubeGeometry(
          new CatmullRomCurve3([from, mid, to]),
          16,
          0.022,
          5,
          false,
        ),
        {
          color: material.rope,
        },
      )
      .build();
  });

// 갈매기 한 마리: 몸통과 좌우 날개를 따로 움직인다.
export const gullBody = () =>
  once("gullBody", () => {
    const b = new Builder(1201);
    b.add(new SphereGeometry(0.2, 12, 8), {
      scale: [0.75, 0.7, 1.4],
      color: art.paper,
    });
    b.add(new SphereGeometry(0.13, 10, 8), {
      at: [0, 0.1, 0.28],
      color: art.paper,
    });
    b.add(new ConeGeometry(0.04, 0.16, 6), {
      at: [0, 0.08, 0.45],
      rot: [Math.PI / 2, 0, 0],
      color: art.butter,
    });
    b.add(new ConeGeometry(0.1, 0.22, 4), {
      at: [0, 0, -0.36],
      rot: [-Math.PI / 2, 0, 0],
      scale: [1, 1, 0.35],
      color: "#DDE3E6",
    });
    for (const s of [-1, 1])
      b.add(new SphereGeometry(0.022, 6, 4), {
        at: [s * 0.08, 0.14, 0.36],
        color: material.pupil,
      });
    return b.build();
  });
export const gullWing = () =>
  once("gullWing", () => {
    const b = new Builder(1202);
    b.add(roundedBox(0.55, 0.03, 0.26, 0.012), {
      at: [0.3, 0, 0],
      color: art.paper,
    });
    b.add(roundedBox(0.2, 0.031, 0.2, 0.012), {
      at: [0.52, 0, -0.02],
      color: "#B9C4CA",
    });
    return b.build();
  });

// 상점 강아지: 몸통(앉은 자세)과 머리를 따로 움직인다. 원점은 엉덩이 아래.
export const dogBody = () =>
  once("dogBody", () => {
    const b = new Builder(1301);
    const cream = "#F7E6C9",
      tan = "#D9A877";
    b.add(new SphereGeometry(0.32, 16, 12), {
      at: [0, 0.34, 0],
      scale: [1, 1.1, 0.95],
      color: cream,
    });
    b.add(new SphereGeometry(0.2, 12, 10), {
      at: [0, 0.38, 0.2],
      scale: [1, 1.1, 0.6],
      color: "#FFF6E8",
    });
    for (const s of [-1, 1]) {
      b.add(new SphereGeometry(0.11, 10, 8), {
        at: [s * 0.14, 0.12, 0.22],
        scale: [1, 0.8, 1.3],
        color: cream,
      });
      b.add(new SphereGeometry(0.13, 10, 8), {
        at: [s * 0.24, 0.16, -0.05],
        scale: [1, 0.8, 1.2],
        color: cream,
      });
    }
    b.add(new TorusGeometry(0.17, 0.035, 6, 20), {
      at: [0, 0.63, 0.04],
      rot: [Math.PI / 2 - 0.2, 0, 0],
      color: art.sky,
    });
    b.add(new SphereGeometry(0.04, 8, 6), {
      at: [0, 0.57, 0.21],
      color: art.butter,
    });
    b.add(new SphereGeometry(0.09, 10, 8), {
      at: [0, 0.32, -0.3],
      scale: [0.8, 1.5, 0.8],
      color: tan,
    });
    return b.build();
  });
export const dogHead = () =>
  once("dogHead", () => {
    const b = new Builder(1302);
    const cream = "#F7E6C9",
      tan = "#D9A877";
    b.add(new SphereGeometry(0.28, 18, 14), {
      scale: [1.05, 0.95, 0.95],
      color: cream,
    });
    b.add(new SphereGeometry(0.15, 14, 10), {
      at: [0, -0.07, 0.22],
      scale: [1.1, 0.8, 0.9],
      color: "#FFF6E8",
    });
    b.add(new SphereGeometry(0.05, 10, 8), {
      at: [0, -0.02, 0.36],
      scale: [1.2, 0.85, 0.8],
      color: material.pupil,
    });
    b.add(new SphereGeometry(0.045, 8, 6), {
      at: [0, -0.16, 0.3],
      scale: [1, 0.5, 0.6],
      color: material.nose,
    });
    for (const s of [-1, 1]) {
      b.add(new SphereGeometry(0.15, 12, 10), {
        at: [s * 0.27, 0.0, -0.02],
        rot: [0, 0, s * 0.35],
        scale: [0.45, 1.05, 0.75],
        color: tan,
      });
      b.add(new SphereGeometry(0.045, 10, 8), {
        at: [s * 0.1, 0.07, 0.24],
        scale: [1, 1.15, 0.6],
        color: material.pupil,
      });
      b.add(new SphereGeometry(0.014, 6, 4), {
        at: [s * 0.1 + 0.012, 0.095, 0.265],
        color: art.paper,
      });
      b.add(new SphereGeometry(0.04, 8, 6), {
        at: [s * 0.19, -0.06, 0.2],
        scale: [1, 0.55, 0.4],
        color: material.blush,
      });
    }
    b.add(new SphereGeometry(0.08, 10, 8), {
      at: [0.12, 0.2, 0.08],
      scale: [1, 0.7, 0.9],
      color: tan,
    });
    return b.build();
  });
export const dogTail = () =>
  once("dogTail", () => {
    const b = new Builder(1303);
    b.add(new CylinderGeometry(0.04, 0.06, 0.26, 8), {
      at: [0, 0.12, 0],
      color: "#F7E6C9",
    });
    b.add(new SphereGeometry(0.05, 8, 6), {
      at: [0, 0.25, 0],
      color: "#F7E6C9",
    });
    return b.build();
  });

export type Geometry = BufferGeometry;
