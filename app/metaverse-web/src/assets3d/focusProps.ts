import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { art } from "../theme";
import { FOCUS_LANDMARKS } from "../layout";
import { Builder, lumpy, rng, roundedBox, type V3 } from "./geometry";
import { GROUND_Y, material } from "./palette";
import { BRIDGES, FALL_LIP, PLUNGE, streamX } from "./pond";

// 낚시섬 소품. 모두 코드로 만든 절차적 geometry이고, 같은 시드는 같은 모양을 낸다.
const memo = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key) as T;
}
// 위를 향한 면에 이끼를 얹는다(정점 색 후처리).
function mossTops(g: BufferGeometry, amount = 0.75, threshold = 0.55) {
  const n = g.getAttribute("normal") as BufferAttribute,
    c = g.getAttribute("color") as BufferAttribute;
  const moss = new Color(material.stoneMoss),
    leaf = new Color(material.moss);
  for (let i = 0; i < n.count; i++) {
    const up = n.getY(i);
    if (up < threshold) continue;
    const k = Math.min(1, (up - threshold) / (1 - threshold)) * amount;
    const tone = i % 7 === 0 ? leaf : moss;
    c.setXYZ(
      i,
      c.getX(i) + (tone.r - c.getX(i)) * k,
      c.getY(i) + (tone.g - c.getY(i)) * k,
      c.getZ(i) + (tone.b - c.getZ(i)) * k,
    );
  }
  return g;
}

// 북쪽 폭포 바위. 랜드마크(반경 2) 안에 큰 바위를 쌓아 3m 남짓한 절벽을 만들고,
// 가운데 홈(FALL_LIP)으로 물이 넘친다. 좌표는 월드 좌표다.
export const waterfallRocks = () =>
  once("waterfallRocks", () => {
    const b = new Builder(3101);
    const random = rng(3102);
    const W = FOCUS_LANDMARKS.waterfall;
    const lipY = FALL_LIP.y;
    // [x, y, z, 반경, 가로·세로·깊이 비율, 색]. 물줄기(가로 ±0.55) 앞은 비워 둔다.
    const dark = "#8F9488",
      mid = "#A6A89A",
      light = "#B8B6A6";
    const rocks: [number, number, number, number, V3, string][] = [
      // 물줄기 뒤 젖은 절벽면과 뒤 큰 덩어리
      [0, 1.15, W.z - 0.95, 1.5, [1.25, 1.2, 0.62], dark],
      [-0.7, 0.75, W.z - 1.45, 1.35, [1.1, 1.05, 0.8], mid],
      [0.75, 0.7, W.z - 1.5, 1.35, [1.1, 1.0, 0.8], mid],
      // 양옆 계단 바위(아래 큰 것 → 위 작은 것)
      [-1.62, 0.55, W.z - 0.05, 0.95, [1, 0.85, 0.95], mid],
      [1.66, 0.5, W.z, 0.98, [1, 0.82, 0.95], light],
      [-1.2, 1.55, W.z - 0.55, 0.72, [1, 0.95, 0.9], light],
      [1.25, 1.5, W.z - 0.6, 0.75, [1, 0.95, 0.9], mid],
      [-0.98, lipY - 0.12, W.z - 0.75, 0.55, [1, 0.8, 0.95], mid],
      [1.0, lipY - 0.08, W.z - 0.8, 0.56, [1, 0.8, 0.95], light],
      // 위쪽 물길 양옆과 꼭대기
      [-0.78, lipY + 0.38, W.z - 1.15, 0.42, [1, 0.85, 1], light],
      [0.82, lipY + 0.42, W.z - 1.2, 0.44, [1, 0.85, 1], mid],
      [0, lipY + 0.3, W.z - 1.85, 0.6, [1.3, 0.8, 0.9], dark],
      // 소 둘레 낮은 바위(소 앞쪽은 비워 물길로 이어지게 한다)
      [-1.22, 0.14, PLUNGE.z + 0.2, 0.36, [1.1, 0.65, 1], mid],
      [1.28, 0.12, PLUNGE.z + 0.25, 0.38, [1.1, 0.65, 1], dark],
      [-0.92, 0.06, PLUNGE.z + 0.78, 0.24, [1.1, 0.6, 1], light],
      [0.98, 0.06, PLUNGE.z + 0.8, 0.22, [1.1, 0.6, 1], mid],
    ];
    rocks.forEach(([x, y, z, r, s, color], i) =>
      b.add(lumpy(r, 1, 0.42, 3110 + i * 7), {
        at: [x, y, z],
        rot: [random() * 0.3, random() * 6, random() * 0.25],
        scale: s,
        color,
        gradient: [0.62, 1.0],
        jitter: 0.05,
        flat: true,
      }),
    );
    // 물이 넘치는 납작한 턱 돌
    b.add(roundedBox(0.95, 0.16, 0.5, 0.06), {
      at: [FALL_LIP.x, lipY - 0.07, FALL_LIP.z - 0.12],
      rot: [0.05, 0, 0],
      color: material.stoneDark,
    });
    return mossTops(b.build(), 0.85, 0.42);
  });

// 폭포 위·바위 틈의 작은 덤불·고사리 자리(월드 좌표)
export const WATERFALL_PLANTS: {
  x: number;
  y: number;
  z: number;
  s: number;
  fern: boolean;
}[] = (() => {
  const W = FOCUS_LANDMARKS.waterfall;
  return [
    { x: -1.25, y: 2.1, z: W.z - 0.55, s: 0.7, fern: false },
    { x: 1.3, y: 2.05, z: W.z - 0.6, s: 0.75, fern: false },
    { x: -0.8, y: FALL_LIP.y + 0.62, z: W.z - 1.15, s: 0.6, fern: true },
    { x: 0.85, y: FALL_LIP.y + 0.66, z: W.z - 1.2, s: 0.62, fern: true },
    { x: 0, y: FALL_LIP.y + 0.62, z: W.z - 1.9, s: 0.95, fern: false },
    { x: -1.7, y: 1.2, z: W.z - 0.05, s: 0.7, fern: true },
    { x: 1.75, y: 1.15, z: W.z, s: 0.72, fern: true },
    { x: -1.45, y: 0.32, z: PLUNGE.z + 0.35, s: 0.55, fern: true },
    { x: 1.5, y: 0.3, z: PLUNGE.z + 0.4, s: 0.55, fern: true },
  ];
})();

// 물길을 건너는 판자 다리. 상판 윗면은 땅보다 3cm 높다(걷는 판정은 땅 그대로).
export const bridgeGeometry = () =>
  once("bridges", () => {
    const b = new Builder(3201);
    const random = rng(3202);
    for (const bridge of BRIDGES) {
      const cx = streamX(bridge.z);
      const planks = Math.round(bridge.length / 0.19);
      for (let i = 0; i < planks; i++) {
        const x = cx - bridge.length / 2 + (i + 0.5) * (bridge.length / planks);
        b.add(
          roundedBox(0.17, 0.06, bridge.width + (random() - 0.5) * 0.06, 0.02),
          {
            at: [x, GROUND_Y + 0.0, bridge.z + (random() - 0.5) * 0.03],
            rot: [0, (random() - 0.5) * 0.04, 0],
            color: i % 3 === 0 ? material.woodLight : material.wood,
            jitter: 0.07,
          },
        );
      }
      for (const s of [-1, 1])
        b.add(roundedBox(bridge.length + 0.1, 0.09, 0.09, 0.025), {
          at: [cx, GROUND_Y - 0.07, bridge.z + s * (bridge.width / 2 - 0.08)],
          color: material.woodDeep,
        });
      // 다리 양 끝의 낮은 말뚝(걷는 길을 막지 않게 바깥 모서리에만)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          b.add(new CylinderGeometry(0.05, 0.06, 0.32, 7), {
            at: [
              cx + sx * (bridge.length / 2 + 0.04),
              GROUND_Y + 0.06,
              bridge.z + sz * (bridge.width / 2 + 0.02),
            ],
            color: material.woodDark,
          });
    }
    return b.build();
  });

// 그늘 쉼터: 판자 마루, 기둥 넷, 두 겹 초가 지붕, 안쪽 긴 의자와 찻상, 처마의 등, 기대 둔 낚싯대.
// 원점은 마루 가운데 땅, 앞(+Z)이 연못을 본다.
export const shelterParts = () =>
  once("shelter", () => {
    const b = new Builder(3301),
      glow = new Builder(3302);
    const random = rng(3303);
    const half = 1.12,
      postH = 2.0,
      floorY = 0.16;
    // 돌 기단과 마루
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      b.add(lumpy(0.2, 1, 0.3, 3310 + x * 3 + z), {
        at: [x * half, 0.06, z * half],
        scale: [1.2, 0.6, 1.2],
        color: material.stone,
        flat: true,
      });
    const boards = 9;
    for (let i = 0; i < boards; i++)
      b.add(
        roundedBox(half * 2 + 0.2, 0.07, (half * 2) / boards - 0.02, 0.02),
        {
          at: [0, floorY, -half + ((i + 0.5) * half * 2) / boards],
          color: i % 3 === 1 ? material.woodLight : material.wood,
          jitter: 0.07,
        },
      );
    b.add(roundedBox(half * 2 + 0.24, 0.1, half * 2 + 0.24, 0.03), {
      at: [0, floorY - 0.08, 0],
      color: material.woodDeep,
    });
    // 기둥과 들보
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      b.add(new CylinderGeometry(0.07, 0.085, postH, 8), {
        at: [x * half, floorY + postH / 2, z * half],
        color: material.woodDark,
        gradient: [0.85, 1.05],
      });
    }
    for (const s of [-1, 1]) {
      b.add(roundedBox(half * 2 + 0.3, 0.12, 0.12, 0.03), {
        at: [0, floorY + postH - 0.04, s * half],
        color: material.wood,
      });
      b.add(roundedBox(0.12, 0.12, half * 2 + 0.3, 0.03), {
        at: [s * half, floorY + postH + 0.06, 0],
        color: material.wood,
      });
    }
    // 두 겹 초가 지붕(사각뿔). 아래 겹은 처마가 넓고, 위 겹은 조금 진하다.
    const roofBase = floorY + postH + 0.08;
    b.add(new ConeGeometry(2.25, 0.95, 4, 2), {
      at: [0, roofBase + 0.46, 0],
      rot: [0, Math.PI / 4, 0],
      color: material.thatch,
      gradient: [0.78, 1.08],
      flat: true,
    });
    b.add(new ConeGeometry(1.35, 0.75, 4, 1), {
      at: [0, roofBase + 0.95, 0],
      rot: [0, Math.PI / 4, 0],
      color: material.thatchDark,
      gradient: [0.85, 1.1],
      flat: true,
    });
    b.add(new SphereGeometry(0.12, 8, 6), {
      at: [0, roofBase + 1.34, 0],
      color: material.woodDark,
    });
    // 처마 끝 짚 다발 띠
    for (let i = 0; i < 4; i++)
      b.add(new TorusGeometry(1.58, 0.05, 4, 4), {
        at: [0, roofBase + 0.02, 0],
        rot: [Math.PI / 2, 0, Math.PI / 4],
        color: material.thatchDark,
      });
    // 뒤쪽 긴 의자와 방석
    b.add(roundedBox(1.7, 0.08, 0.42, 0.03), {
      at: [0, floorY + 0.42, -half + 0.32],
      color: material.woodLight,
    });
    for (const x of [-0.72, 0.72])
      b.add(roundedBox(0.08, 0.38, 0.36, 0.02), {
        at: [x, floorY + 0.21, -half + 0.32],
        color: material.woodDark,
      });
    b.add(roundedBox(1.7, 0.4, 0.06, 0.03), {
      at: [0, floorY + 0.68, -half + 0.12],
      rot: [-0.12, 0, 0],
      color: material.wood,
    });
    for (const [x, tone] of [
      [-0.45, art.pink],
      [0.4, art.sky],
    ] as const)
      b.add(roundedBox(0.46, 0.08, 0.36, 0.035, 3), {
        at: [x, floorY + 0.5, -half + 0.34],
        color: tone,
      });
    // 낮은 찻상과 주전자·찻잔
    b.add(new CylinderGeometry(0.36, 0.36, 0.05, 18), {
      at: [0.1, floorY + 0.3, 0.05],
      color: material.woodLight,
    });
    for (const a of [0, 2.1, 4.2])
      b.add(new CylinderGeometry(0.03, 0.03, 0.26, 6), {
        at: [
          0.1 + Math.cos(a) * 0.24,
          floorY + 0.14,
          0.05 + Math.sin(a) * 0.24,
        ],
        color: material.woodDark,
      });
    b.add(new SphereGeometry(0.11, 12, 8), {
      at: [0.05, floorY + 0.42, 0.05],
      scale: [1, 0.85, 1],
      color: material.tealLight,
    });
    b.add(new CylinderGeometry(0.018, 0.026, 0.14, 6), {
      at: [0.17, floorY + 0.43, 0.05],
      rot: [0, 0, -0.9],
      color: material.tealLight,
    });
    b.add(new TorusGeometry(0.06, 0.012, 4, 10, Math.PI), {
      at: [0.05, floorY + 0.51, 0.05],
      color: material.tealDark,
    });
    for (const [x, z] of [
      [0.3, 0.2],
      [-0.12, -0.15],
    ])
      b.add(new CylinderGeometry(0.04, 0.032, 0.06, 10), {
        at: [x, floorY + 0.36, z],
        color: art.paper,
      });
    // 처마 앞 등(빛나는 부분은 glow)
    b.add(new CylinderGeometry(0.012, 0.012, 0.3, 4), {
      at: [0.75, floorY + postH - 0.25, half],
      color: material.woodDeep,
    });
    b.add(new ConeGeometry(0.13, 0.09, 6), {
      at: [0.75, floorY + postH - 0.42, half],
      color: material.woodDeep,
    });
    glow.add(new SphereGeometry(0.09, 10, 8), {
      at: [0.75, floorY + postH - 0.53, half],
      scale: [1, 1.2, 1],
      color: material.lampGlow,
    });
    // 쉼터 옆 작은 바구니
    const basket = new LatheGeometry(
      [
        new Vector2(0.001, 0),
        new Vector2(0.18, 0),
        new Vector2(0.22, 0.2),
        new Vector2(0.2, 0.21),
        new Vector2(0.16, 0.02),
      ],
      14,
    );
    b.add(basket, {
      at: [half + 0.35, 0, half - 0.1],
      color: material.thatchDark,
    });
    // 마루 앞 꽃 화분 두 개
    for (const x of [-0.55, 0.65]) {
      b.add(new CylinderGeometry(0.13, 0.1, 0.2, 10), {
        at: [x, floorY + 0.14, half - 0.12],
        color: material.roofDark,
      });
      for (let i = 0; i < 5; i++) {
        const a = random() * 6.28;
        b.add(new SphereGeometry(0.05, 6, 4), {
          at: [
            x + Math.cos(a) * 0.07,
            floorY + 0.3 + random() * 0.06,
            half - 0.12 + Math.sin(a) * 0.07,
          ],
          color: i % 2 ? art.pink : art.butter,
        });
      }
      b.add(new SphereGeometry(0.1, 8, 6), {
        at: [x, floorY + 0.26, half - 0.12],
        scale: [1, 0.6, 1],
        color: material.leafDark,
      });
    }
    return { solid: b.build(), glow: glow.build() };
  });

// 축음기와 받침 탁자. 원점은 탁자 가운데 땅, 앞(+Z)이 연못을 본다.
// 판(record)은 따로 돌린다.
export const GRAMOPHONE_TOP = 0.86;
export const gramophoneParts = () =>
  once("gramophone", () => {
    const b = new Builder(3401);
    // 둥근 탁자
    b.add(new CylinderGeometry(0.46, 0.44, 0.06, 22), {
      at: [0, 0.64, 0],
      color: material.woodLight,
    });
    b.add(new CylinderGeometry(0.06, 0.08, 0.6, 10), {
      at: [0, 0.32, 0],
      color: material.woodDark,
    });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      b.add(roundedBox(0.36, 0.05, 0.07, 0.02), {
        at: [Math.cos(a) * 0.17, 0.03, Math.sin(a) * 0.17],
        rot: [0, -a, 0],
        color: material.woodDark,
      });
    }
    // 본체 상자와 놋쇠 테두리
    b.add(roundedBox(0.46, 0.17, 0.46, 0.03), {
      at: [0, 0.755, 0],
      color: "#9C6440",
    });
    b.add(roundedBox(0.48, 0.025, 0.48, 0.01), {
      at: [0, 0.84, 0],
      color: material.brass,
    });
    b.add(roundedBox(0.3, 0.07, 0.01, 0.005), {
      at: [0, 0.75, 0.232],
      color: "#B87848",
    });
    // 태엽 손잡이
    b.add(new CylinderGeometry(0.012, 0.012, 0.12, 5), {
      at: [0.29, 0.76, 0],
      rot: [0, 0, Math.PI / 2],
      color: material.brass,
    });
    b.add(new SphereGeometry(0.03, 6, 4), {
      at: [0.35, 0.79, 0],
      color: "#65462F",
    });
    // 소리통 목과 나팔: 상자 뒤에서 올라와 앞쪽 위(연못 쪽)로 벌어진다.
    const mouth = new Vector3(0, 1.1, -0.1);
    const toward = new Vector3(0, 0.62, 0.78).normalize();
    const neck = new CatmullRomCurve3([
      new Vector3(-0.1, 0.84, -0.14),
      new Vector3(-0.1, 0.98, -0.2),
      new Vector3(-0.04, 1.06, -0.16),
      mouth.clone(),
    ]);
    b.add(new TubeGeometry(neck, 12, 0.03, 8, false), {
      color: material.brass,
    });
    const length = 0.56;
    const profile = Array.from({ length: 14 }, (_, i) => {
      const t = i / 13;
      return new Vector2(0.032 + 0.3 * Math.pow(t, 2.6), t * length);
    });
    const hornMatrix = new Matrix4().compose(
      mouth,
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), toward),
      new Vector3(1, 1, 1),
    );
    // 바깥(분홍)과 안쪽(크림). 안쪽은 점 순서를 뒤집어 면이 안을 보게 한다.
    b.add(new LatheGeometry(profile, 26), {
      matrix: hornMatrix,
      color: art.pink,
      gradient: [0.85, 1.08],
    });
    b.add(
      new LatheGeometry(
        profile.map((p) => new Vector2(p.x - 0.008, p.y)).reverse(),
        26,
      ),
      { matrix: hornMatrix, color: material.hornInner },
    );
    const rim = mouth.clone().addScaledVector(toward, length);
    b.add(new TorusGeometry(0.332, 0.016, 6, 30), {
      matrix: new Matrix4().compose(
        rim,
        new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), toward),
        new Vector3(1, 1, 1),
      ),
      color: material.brass,
    });
    // 바늘 팔
    b.add(new CylinderGeometry(0.012, 0.012, 0.22, 5), {
      at: [0.1, 0.885, -0.05],
      rot: [0, 0, Math.PI / 2 - 0.3],
      color: material.brass,
    });
    b.add(new SphereGeometry(0.025, 6, 4), {
      at: [0.2, 0.89, -0.08],
      color: material.brass,
    });
    return b.build();
  });
export const recordGeometry = () =>
  once("record", () => {
    const b = new Builder(3402);
    b.add(new CylinderGeometry(0.17, 0.17, 0.012, 28), {
      color: material.record,
    });
    for (const r of [0.07, 0.11, 0.15])
      b.add(new TorusGeometry(r, 0.002, 3, 32), {
        at: [0, 0.007, 0],
        rot: [Math.PI / 2, 0, 0],
        color: "#24211F",
      });
    b.add(new CylinderGeometry(0.05, 0.05, 0.014, 18), { color: art.pink });
    b.add(roundedBox(0.03, 0.004, 0.012, 0.002), {
      at: [0.025, 0.008, 0],
      color: art.paper,
    });
    b.add(new CylinderGeometry(0.006, 0.006, 0.04, 5), {
      color: material.brass,
    });
    return b.build();
  });
// 나팔에서 떠오르는 음표 하나(머리·기둥·깃발)
export const noteGeometry = () =>
  once("note", () => {
    const b = new Builder(3403);
    b.add(new SphereGeometry(0.05, 10, 6), {
      scale: [1.2, 0.85, 0.5],
      rot: [0, 0, 0.35],
      color: "#ffffff",
    });
    b.add(new CylinderGeometry(0.009, 0.009, 0.17, 5), {
      at: [0.05, 0.085, 0],
      color: "#ffffff",
    });
    b.add(roundedBox(0.07, 0.022, 0.012, 0.006), {
      at: [0.083, 0.16, 0],
      rot: [0, 0, -0.5],
      color: "#ffffff",
    });
    return b.build();
  });

// 갈대(부들): 휜 잎 5장과 갈색 이삭 두 개. 높이 약 1.3(크기 1 기준).
export const reedGeometry = (variant: number) =>
  once(`reed${variant}`, () => {
    const random = rng(3500 + variant);
    const pos: number[] = [],
      col: number[] = [],
      nor: number[] = [],
      idx: number[] = [];
    const base = new Color(material.reedDark).multiplyScalar(0.85),
      tip = new Color(variant === 2 ? "#C9C784" : material.reed);
    const rows = [0, 0.3, 0.6, 0.85, 1];
    for (let blade = 0; blade < 5; blade++) {
      const a = (blade / 5) * Math.PI * 2 + random() * 0.8;
      const lean = 0.12 + random() * 0.22,
        h = 0.9 + random() * 0.45,
        w = 0.05 + random() * 0.02;
      const dx = Math.cos(a),
        dz = Math.sin(a);
      const start = pos.length / 3;
      for (const t of rows) {
        const off = 0.02 + lean * t * t;
        const cx = dx * off,
          cz = dz * off,
          y = h * t - 0.1 * lean * t * t,
          half = w * (1 - t * 0.85) * 0.5 + 0.002;
        pos.push(
          cx - dz * half,
          y,
          cz + dx * half,
          cx + dz * half,
          y,
          cz - dx * half,
        );
        const c = base.clone().lerp(tip, t);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        nor.push(dx * 0.5, 1, dz * 0.5, dx * 0.5, 1, dz * 0.5);
      }
      for (let r = 0; r < rows.length - 1; r++) {
        const i = start + r * 2;
        idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
    const blades = new BufferGeometry();
    blades.setAttribute("position", new Float32BufferAttribute(pos, 3));
    blades.setAttribute("normal", new Float32BufferAttribute(nor, 3));
    blades.setAttribute("color", new Float32BufferAttribute(col, 3));
    blades.setIndex(idx);
    blades.normalizeNormals();
    const b = new Builder(3510 + variant);
    b.add(blades, { color: "#ffffff" });
    // Builder.add는 색을 덮으므로 잎은 원래 색을 다시 칠한다(아래).
    const stems = variant === 1 ? 1 : 2;
    for (let i = 0; i < stems; i++) {
      const x = (i - 0.5) * 0.08,
        h = 1.15 + i * 0.18;
      b.add(new CylinderGeometry(0.008, 0.012, h, 4), {
        at: [x, h / 2, 0.02 * i],
        color: material.reedDark,
      });
      b.add(new CylinderGeometry(0.035, 0.035, 0.2, 7), {
        at: [x, h - 0.12, 0.02 * i],
        color: material.cattail,
      });
      b.add(new SphereGeometry(0.035, 7, 4), {
        at: [x, h - 0.02, 0.02 * i],
        scale: [1, 0.6, 1],
        color: material.cattail,
      });
      b.add(new SphereGeometry(0.035, 7, 4), {
        at: [x, h - 0.22, 0.02 * i],
        scale: [1, 0.6, 1],
        color: material.cattail,
      });
    }
    const g = b.build();
    // 잎 정점 색 되살리기: 처음 blades 정점 수만큼 원래 색을 복사한다.
    const c = g.getAttribute("color") as BufferAttribute;
    for (let i = 0; i < col.length / 3; i++)
      c.setXYZ(i, col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
    return g;
  });

// 수련잎(갈라진 원판)과 연꽃
export const lilyPadGeometry = () =>
  once("lilyPad", () => {
    const b = new Builder(3601);
    b.add(new CircleGeometry(1, 22, 0.32, Math.PI * 2 - 0.32), {
      rot: [-Math.PI / 2, 0, 0],
      color: material.lily,
    });
    b.add(new CircleGeometry(0.72, 18, 0.32, Math.PI * 2 - 0.32), {
      at: [0, 0.004, 0],
      rot: [-Math.PI / 2, 0, 0],
      color: material.lilyLight,
    });
    for (let i = 0; i < 5; i++) {
      const a = 0.65 + i * 1.15;
      b.add(roundedBox(0.85, 0.006, 0.035, 0.002), {
        at: [Math.cos(a) * 0.45, 0.008, -Math.sin(a) * 0.45],
        rot: [0, a, 0],
        color: material.lily,
      });
    }
    return b.build();
  });
export const lotusGeometry = () =>
  once("lotus", () => {
    const b = new Builder(3602);
    const petal = new SphereGeometry(0.1, 8, 5);
    for (let ring = 0; ring < 2; ring++)
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + ring * 0.45;
        const r = ring ? 0.07 : 0.11;
        b.add(petal, {
          at: [Math.cos(a) * r, 0.07 + ring * 0.04, Math.sin(a) * r],
          rot: [0, -a, ring ? 0.9 : 0.55],
          scale: [1.1, 0.35, 0.6],
          color: ring ? "#FFF2F4" : art.pink,
        });
      }
    b.add(new SphereGeometry(0.05, 8, 6), {
      at: [0, 0.1, 0],
      color: art.butter,
    });
    return b.build();
  });

// 잠자리: 가는 몸통과 투명해 보이는 밝은 날개 네 장. 원점은 몸통 가운데, 앞이 +Z.
export const dragonflyBody = () =>
  once("dragonflyBody", () => {
    const b = new Builder(3701);
    b.add(new CylinderGeometry(0.012, 0.008, 0.26, 6), {
      at: [0, 0, -0.08],
      rot: [Math.PI / 2, 0, 0],
      color: material.tealDark,
    });
    b.add(new SphereGeometry(0.03, 8, 6), {
      at: [0, 0, 0.06],
      color: material.teal,
    });
    for (const s of [-1, 1])
      b.add(new SphereGeometry(0.018, 6, 4), {
        at: [s * 0.022, 0.012, 0.085],
        color: material.pupil,
      });
    return b.build();
  });
export const dragonflyWing = () =>
  once("dragonflyWing", () => {
    const b = new Builder(3702);
    b.add(new SphereGeometry(0.1, 8, 4), {
      at: [0.1, 0, 0],
      scale: [1, 0.08, 0.26],
      color: "#E4F4F6",
    });
    return b.build();
  });
