import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { art } from "../theme";
import { Builder, compose, lumpy, rng, roundedBox, type V3 } from "./geometry";
import { material } from "./palette";

export type BuildingParts = {
  solid: BufferGeometry;
  glow?: BufferGeometry;
  cloth?: BufferGeometry;
};
const memo = new Map<string, BuildingParts>();
const once = (key: string, make: () => BuildingParts) => {
  let parts = memo.get(key);
  if (!parts) memo.set(key, (parts = make()));
  return parts;
};
const bookTones = [
  art.pink,
  art.sky,
  art.butter,
  "#9FD8C3",
  material.roof,
  "#F7C9A6",
  art.paper,
  "#C9B6E4",
];

// 기와 지붕 한 면. 경사면 좌표계(x: 가로, z: 용마루→처마)에서 반원 기와를 줄지어 붙인다.
function tiledRoof(
  b: Builder,
  o: {
    width: number;
    eaveY: number;
    ridgeY: number;
    eaveZ: number;
    tones: string[];
    rows: number;
    cols: number;
    board: string;
  },
) {
  const rise = o.ridgeY - o.eaveY;
  const alpha = Math.atan2(rise, o.eaveZ);
  const length = Math.hypot(rise, o.eaveZ) + 0.05;
  const front = compose(
    [0, (o.eaveY + o.ridgeY) / 2, o.eaveZ / 2],
    [alpha, 0, 0],
  );
  const tile = new CylinderGeometry(
    0.5,
    0.5,
    1,
    7,
    1,
    true,
    Math.PI / 2,
    Math.PI,
  );
  const rowLength = length / o.rows,
    colWidth = o.width / o.cols;
  for (const side of [
    front,
    new Matrix4().makeRotationY(Math.PI).multiply(front),
  ]) {
    b.add(roundedBox(o.width + 0.06, 0.08, length + 0.04, 0.03), {
      matrix: side,
      color: o.board,
    });
    for (let r = 0; r < o.rows; r++) {
      const z = length / 2 - (r + 0.5) * rowLength;
      const shift = r % 2 ? colWidth / 2 : 0;
      for (let c = 0; c <= o.cols; c++) {
        const x = -o.width / 2 + colWidth * (c + 0.5) - shift;
        if (Math.abs(x) > o.width / 2 - colWidth * 0.45) continue;
        const local = compose(
          [x, 0.04, z],
          [Math.PI / 2 - 0.05, 0, 0],
          [colWidth, rowLength * 1.12, colWidth * 0.5],
        );
        b.add(tile, {
          matrix: side.clone().multiply(local),
          color: o.tones[(r * 7 + c * 3) % o.tones.length],
          jitter: 0.05,
        });
      }
    }
  }
  b.add(new CylinderGeometry(0.11, 0.11, o.width + 0.1, 10), {
    at: [0, o.ridgeY + 0.06, 0],
    rot: [0, 0, Math.PI / 2],
    color: o.tones[o.tones.length - 1],
  });
  for (const s of [-1, 1])
    b.add(new SphereGeometry(0.15, 10, 8), {
      at: [s * (o.width / 2 + 0.06), o.ridgeY + 0.06, 0],
      color: o.tones[o.tones.length - 1],
    });
}

function gable(
  b: Builder,
  x: number,
  eaveY: number,
  ridgeY: number,
  halfZ: number,
  color: string,
  trim: string,
) {
  const shape = new Shape()
    .moveTo(-halfZ, 0)
    .lineTo(halfZ, 0)
    .lineTo(0, ridgeY - eaveY)
    .closePath();
  const g = new ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
  b.add(g, {
    at: [x - 0.05 * Math.sign(x), eaveY, 0],
    rot: [0, (Math.sign(x) * Math.PI) / 2, 0],
    color,
  });
  b.add(roundedBox(0.1, ridgeY - eaveY - 0.1, 0.1, 0.02), {
    at: [x + 0.03 * Math.sign(x), (eaveY + ridgeY) / 2 - 0.05, 0],
    color: trim,
  });
  b.add(roundedBox(0.1, 0.1, halfZ * 2 - 0.1, 0.02), {
    at: [x + 0.03 * Math.sign(x), eaveY + 0.05, 0],
    color: trim,
  });
}

function lantern(b: Builder, glow: Builder, at: V3, hang = 0.25) {
  const [x, y, z] = at;
  if (hang > 0)
    b.add(new CylinderGeometry(0.012, 0.012, hang, 4), {
      at: [x, y + hang / 2 + 0.17, z],
      color: material.woodDeep,
    });
  b.add(roundedBox(0.24, 0.05, 0.24, 0.015), {
    at: [x, y + 0.16, z],
    color: material.woodDeep,
  });
  b.add(new ConeGeometry(0.17, 0.12, 4), {
    at: [x, y + 0.24, z],
    rot: [0, Math.PI / 4, 0],
    color: material.woodDeep,
  });
  b.add(roundedBox(0.2, 0.05, 0.2, 0.015), {
    at: [x, y - 0.14, z],
    color: material.woodDeep,
  });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      b.add(new CylinderGeometry(0.013, 0.013, 0.26, 4), {
        at: [x + sx * 0.085, y + 0.01, z + sz * 0.085],
        color: material.woodDeep,
      });
  glow.add(new CylinderGeometry(0.075, 0.075, 0.24, 8), {
    at: [x, y + 0.01, z],
    color: material.lampGlow,
  });
}

function flowerPot(b: Builder, at: V3, tone: string, seed: number) {
  const random = rng(seed);
  const [x, y, z] = at;
  b.add(new CylinderGeometry(0.2, 0.15, 0.3, 12), {
    at: [x, y + 0.15, z],
    color: material.roofDark,
    gradient: [0.85, 1.05],
  });
  b.add(new TorusGeometry(0.19, 0.03, 6, 14), {
    at: [x, y + 0.3, z],
    rot: [Math.PI / 2, 0, 0],
    color: material.roof,
  });
  b.add(lumpy(0.22, 1, 0.3, seed), {
    at: [x, y + 0.42, z],
    color: material.leaf,
    gradient: [0.8, 1.1],
    softCenter: [x, y + 0.35, z],
  });
  for (let i = 0; i < 5; i++) {
    const a = random() * Math.PI * 2;
    b.add(new SphereGeometry(0.05, 6, 4), {
      at: [
        x + Math.cos(a) * 0.17,
        y + 0.5 + random() * 0.12,
        z + Math.sin(a) * 0.15,
      ],
      color: tone,
    });
  }
}

function vines(b: Builder, at: V3, height: number, seed: number) {
  const random = rng(seed);
  for (let i = 0; i < 9; i++) {
    const y = at[1] + (i / 9) * height,
      a = random() * Math.PI * 2;
    b.add(new SphereGeometry(0.07 + random() * 0.04, 6, 4), {
      at: [at[0] + Math.cos(a) * 0.1, y, at[2] + Math.sin(a) * 0.1],
      scale: [1, 0.7, 1],
      color: i % 3 ? material.leaf : material.leafDark,
    });
    if (i % 3 === 1)
      b.add(new SphereGeometry(0.04, 6, 4), {
        at: [at[0] + Math.cos(a) * 0.16, y + 0.04, at[2] + Math.sin(a) * 0.16],
        color: "#FFF4DA",
      });
  }
}

// 마을회관: 높은 나무 마루, 책장 벽, 주황 기와 지붕의 열린 정자. 앞(+Z)에 계단.
export const hallParts = () =>
  once("hall", () => {
    const b = new Builder(501),
      glow = new Builder(502),
      cloth = new Builder(503);
    const random = rng(504);
    const deckY = 0.42;
    // 돌 기단과 마루
    for (let i = 0; i < 18; i++) {
      const t = i / 18;
      const per = t * 4;
      const side = Math.floor(per),
        f = per - side;
      const x =
        side === 0
          ? -1.85 + f * 3.7
          : side === 1
            ? 1.85
            : side === 2
              ? 1.85 - f * 3.7
              : -1.85;
      const z =
        side === 0
          ? 1.62
          : side === 1
            ? 1.62 - f * 3.24
            : side === 2
              ? -1.62
              : -1.62 + f * 3.24;
      b.add(lumpy(0.3, 1, 0.25, 520 + i), {
        at: [x, 0.16, z],
        scale: [1.25, 0.75, 1.1],
        color: material.stone,
        gradient: [0.8, 1.05],
        flat: true,
      });
    }
    b.add(roundedBox(3.8, 0.3, 3.3, 0.06), {
      at: [0, 0.18, 0],
      color: material.stoneDark,
    });
    for (let i = 0; i < 12; i++)
      b.add(roundedBox(3.96, 0.08, 0.27, 0.02), {
        at: [0, deckY - 0.04, -1.5 + i * 0.275],
        color: [material.wood, material.woodLight, material.wood][i % 3],
        jitter: 0.07,
      });
    // 계단
    for (let i = 0; i < 2; i++)
      b.add(roundedBox(1.4, 0.13, 0.34, 0.03), {
        at: [0, 0.07 + i * 0.14, 2.17 - i * 0.3],
        color: i ? material.woodLight : material.wood,
      });
    // 기둥과 들보
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        b.add(roundedBox(0.2, 2.35, 0.2, 0.04), {
          at: [sx * 1.78, deckY + 1.17, sz * 1.5],
          color: material.woodDark,
        });
        vines(b, [sx * 1.86, deckY + 0.1, sz * 1.58], 1.9, 530 + sx * 3 + sz);
      }
    b.add(roundedBox(0.2, 2.35, 0.2, 0.04), {
      at: [0, deckY + 1.17, -1.5],
      color: material.woodDark,
    });
    for (const sz of [-1, 1])
      b.add(roundedBox(3.9, 0.2, 0.22, 0.04), {
        at: [0, deckY + 2.32, sz * 1.5],
        color: material.wood,
      });
    for (const sx of [-1, 1])
      b.add(roundedBox(0.22, 0.2, 3.2, 0.04), {
        at: [sx * 1.78, deckY + 2.32, 0],
        color: material.wood,
      });
    // 뒤 벽(회벽+나무 띠)과 책장
    b.add(roundedBox(3.4, 2.2, 0.12, 0.03), {
      at: [0, deckY + 1.15, -1.58],
      color: material.plaster,
    });
    b.add(roundedBox(3.4, 0.1, 0.14, 0.02), {
      at: [0, deckY + 1.2, -1.56],
      color: material.woodDark,
    });
    b.add(roundedBox(2.7, 1.75, 0.38, 0.03), {
      at: [0, deckY + 0.9, -1.35],
      color: material.woodDark,
    });
    for (let s = 0; s < 4; s++) {
      const y = deckY + 0.12 + s * 0.42;
      b.add(roundedBox(2.56, 0.05, 0.34, 0.01), {
        at: [0, y, -1.32],
        color: material.wood,
      });
      let x = -1.2;
      while (x < 1.15) {
        const w = 0.07 + random() * 0.07,
          h = 0.24 + random() * 0.1;
        if (random() > 0.1)
          b.add(roundedBox(w - 0.01, h, 0.26, 0.012), {
            at: [x + w / 2, y + 0.025 + h / 2, -1.28],
            rot: [0, 0, random() < 0.12 ? 0.18 : 0],
            color: bookTones[Math.floor(random() * bookTones.length)],
            jitter: 0.06,
          });
        x += w;
      }
    }
    // 양옆 난간
    for (const sx of [-1, 1]) {
      for (const y of [deckY + 0.12, deckY + 0.78])
        b.add(roundedBox(0.09, 0.08, 3.0, 0.02), {
          at: [sx * 1.78, y, 0],
          color: material.woodLight,
        });
      for (let i = 0; i < 9; i++)
        b.add(roundedBox(0.06, 0.66, 0.06, 0.015), {
          at: [sx * 1.78, deckY + 0.45, -1.3 + i * 0.32],
          color: material.wood,
        });
    }
    // 지붕
    const eaveY = deckY + 2.42,
      ridgeY = deckY + 3.55;
    gable(b, 1.88, eaveY, ridgeY, 1.62, material.plaster, material.woodDark);
    gable(b, -1.88, eaveY, ridgeY, 1.62, material.plaster, material.woodDark);
    tiledRoof(b, {
      width: 4.6,
      eaveY: eaveY - 0.3,
      ridgeY: ridgeY + 0.05,
      eaveZ: 2.18,
      tones: [
        material.roof,
        material.roofLight,
        material.roof,
        material.roofDark,
      ],
      rows: 7,
      cols: 15,
      board: material.woodDark,
    });
    // 굴뚝
    b.add(roundedBox(0.46, 1.1, 0.46, 0.05), {
      at: [1.15, ridgeY - 0.1, -0.85],
      color: material.stone,
    });
    b.add(roundedBox(0.58, 0.12, 0.58, 0.04), {
      at: [1.15, ridgeY + 0.5, -0.85],
      color: material.stoneDark,
    });
    // 앞 간판: 발바닥
    b.add(roundedBox(1.15, 0.42, 0.08, 0.05), {
      at: [0, deckY + 2.0, 1.66],
      color: material.woodLight,
    });
    b.add(new CylinderGeometry(0.11, 0.11, 0.04, 16), {
      at: [0, deckY + 1.96, 1.71],
      rot: [Math.PI / 2, 0, 0],
      scale: [1.15, 1, 0.9],
      color: material.roofDark,
    });
    for (const [x, y] of [
      [-0.17, 0.12],
      [-0.06, 0.18],
      [0.06, 0.18],
      [0.17, 0.12],
    ])
      b.add(new CylinderGeometry(0.045, 0.045, 0.04, 10), {
        at: [x, deckY + 1.96 + y, 1.71],
        rot: [Math.PI / 2, 0, 0],
        color: material.roofDark,
      });
    // 마루 위 살림: 둥근 깔개·방석·낮은 탁자
    b.add(new CylinderGeometry(0.85, 0.85, 0.02, 32), {
      at: [0.05, deckY + 0.01, 0.25],
      color: "#F7C9A6",
    });
    b.add(new TorusGeometry(0.66, 0.035, 6, 32), {
      at: [0.05, deckY + 0.025, 0.25],
      rot: [Math.PI / 2, 0, 0],
      color: art.pink,
    });
    b.add(new CylinderGeometry(0.34, 0.34, 0.06, 20), {
      at: [0.05, deckY + 0.33, 0.25],
      color: material.woodLight,
    });
    b.add(new CylinderGeometry(0.06, 0.1, 0.3, 8), {
      at: [0.05, deckY + 0.16, 0.25],
      color: material.woodDark,
    });
    b.add(new CylinderGeometry(0.07, 0.06, 0.1, 10), {
      at: [0.12, deckY + 0.41, 0.2],
      color: art.paper,
    });
    for (const [x, z, tone] of [
      [-0.85, 0.75, art.sky],
      [0.95, 0.65, art.butter],
      [-0.95, -0.35, art.pink],
    ] as const)
      b.add(roundedBox(0.5, 0.13, 0.5, 0.06, 3), {
        at: [x, deckY + 0.07, z],
        rot: [0, random() * 0.6, 0],
        color: tone,
      });
    // 칠판 이젤
    b.add(roundedBox(0.75, 0.6, 0.05, 0.02), {
      at: [1.55, 0.95, 2.3],
      rot: [-0.2, -0.3, 0],
      color: material.woodDark,
    });
    b.add(roundedBox(0.63, 0.48, 0.06, 0.01), {
      at: [1.55, 0.95, 2.31],
      rot: [-0.2, -0.3, 0],
      color: "#45615A",
    });
    for (const sx of [-1, 1])
      b.add(new CylinderGeometry(0.025, 0.025, 1.2, 5), {
        at: [1.55 + sx * 0.28, 0.6, 2.24],
        rot: [-0.2, -0.3, sx * 0.08],
        color: material.wood,
      });
    for (let i = 0; i < 3; i++)
      b.add(roundedBox(0.36 - i * 0.08, 0.025, 0.01, 0.005), {
        at: [1.55 - 0.03, 1.08 - i * 0.12, 2.36 - i * 0.025],
        rot: [-0.2, -0.3, 0],
        color: art.paper,
      });
    // 화분과 등
    flowerPot(b, [-1.05, 0, 2.25], art.pink, 540);
    flowerPot(b, [1.0, 0, 1.95], art.butter, 541);
    lantern(b, glow, [-1.78, deckY + 1.95, 1.72], 0.15);
    lantern(b, glow, [1.78, deckY + 1.95, 1.72], 0.15);
    // 앞 들보의 삼각 깃발
    const flagTones = [art.pink, art.sky, art.butter, "#9FD8C3"];
    for (let i = 0; i < 11; i++) {
      const x = -1.6 + i * 0.32;
      if (Math.abs(x) < 0.66) continue;
      const sag = 0.18 * Math.sin((i / 10) * Math.PI);
      cloth.add(new ConeGeometry(0.11, 0.24, 3, 1), {
        at: [x, deckY + 2.08 - sag, 1.62],
        rot: [0, 0, Math.PI],
        scale: [1, 1, 0.15],
        color: flagTones[i % 4],
      });
    }
    cloth.add(new CylinderGeometry(0.008, 0.008, 3.5, 4), {
      at: [0, deckY + 2.22 - 0.09, 1.62],
      rot: [0, 0, Math.PI / 2],
      color: material.rope,
    });
    return { solid: b.build(), glow: glow.build(), cloth: cloth.build() };
  });

// 강아지 상점: 돌 기단, 나무 계산대와 선반, 청록 기와와 꽃 장식 천.
export const shopParts = () =>
  once("shop", () => {
    const b = new Builder(601),
      glow = new Builder(602),
      cloth = new Builder(603);
    const random = rng(604);
    const floorY = 0.34;
    for (let i = 0; i < 22; i++) {
      const t = i / 22,
        per = t * 4,
        side = Math.floor(per),
        f = per - side;
      const x =
        side === 0
          ? -1.72 + f * 3.44
          : side === 1
            ? 1.72
            : side === 2
              ? 1.72 - f * 3.44
              : -1.72;
      const z =
        side === 0
          ? 1.5
          : side === 1
            ? 1.5 - f * 3.0
            : side === 2
              ? -1.5
              : -1.5 + f * 3.0;
      b.add(roundedBox(0.44, 0.32, 0.36, 0.08), {
        at: [x, 0.16, z],
        rot: [0, random() * 0.3, 0],
        color: [material.stone, material.stoneDark, "#CFCDC1"][i % 3],
        jitter: 0.05,
      });
    }
    b.add(roundedBox(3.4, 0.3, 2.95, 0.05), {
      at: [0, 0.16, 0],
      color: material.stoneDark,
    });
    for (let i = 0; i < 11; i++)
      b.add(roundedBox(0.3, 0.07, 3.0, 0.02), {
        at: [-1.5 + i * 0.3, floorY - 0.03, 0],
        color: [material.woodLight, material.wood][i % 2],
        jitter: 0.06,
      });
    b.add(roundedBox(1.1, 0.14, 0.4, 0.03), {
      at: [0, 0.07, 1.78],
      color: material.wood,
    });
    // 기둥
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        b.add(roundedBox(0.17, 2.3, 0.17, 0.04), {
          at: [sx * 1.62, floorY + 1.13, sz * 1.38],
          color: material.woodDark,
        });
      }
    vines(b, [1.7, floorY + 0.2, 1.46], 1.8, 610);
    // 뒤·옆 판자벽
    for (let i = 0; i < 12; i++)
      b.add(roundedBox(0.27, 2.1, 0.08, 0.02), {
        at: [-1.5 + i * 0.273, floorY + 1.05, -1.42],
        color: [material.wood, material.woodLight][i % 2],
        jitter: 0.06,
      });
    for (const sx of [-1, 1])
      for (let i = 0; i < 5; i++)
        b.add(roundedBox(0.08, 1.15, 0.27, 0.02), {
          at: [sx * 1.62, floorY + 0.58, -1.2 + i * 0.27],
          color: [material.wood, material.woodLight][i % 2],
          jitter: 0.06,
        });
    // 선반과 물건
    for (let s = 0; s < 3; s++) {
      const y = floorY + 0.75 + s * 0.48;
      b.add(roundedBox(2.7, 0.05, 0.36, 0.01), {
        at: [0, y, -1.2],
        color: material.woodDark,
      });
      let x = -1.2;
      let k = 0;
      while (x < 1.15) {
        const kind = (k + s) % 3;
        if (kind === 0) {
          b.add(new CylinderGeometry(0.09, 0.09, 0.22, 12), {
            at: [x + 0.1, y + 0.135, -1.18],
            color: [art.sky, "#9FD8C3", art.pink][k % 3],
          });
          b.add(new CylinderGeometry(0.095, 0.095, 0.04, 12), {
            at: [x + 0.1, y + 0.26, -1.18],
            color: material.woodLight,
          });
          x += 0.24;
        } else if (kind === 1) {
          for (let j = 0; j < 3; j++)
            b.add(roundedBox(0.28, 0.07, 0.24, 0.02), {
              at: [x + 0.15, y + 0.06 + j * 0.075, -1.18],
              color: [art.sky, material.teal, art.paper][(j + k) % 3],
            });
          x += 0.34;
        } else {
          b.add(new SphereGeometry(0.12, 12, 8), {
            at: [x + 0.12, y + 0.13, -1.18],
            scale: [1, 0.9, 1],
            color: material.glass,
          });
          b.add(new CylinderGeometry(0.06, 0.06, 0.05, 8), {
            at: [x + 0.12, y + 0.25, -1.18],
            color: material.mailRed,
          });
          x += 0.28;
        }
        k++;
      }
    }
    // 계산대
    b.add(roundedBox(2.7, 0.85, 0.55, 0.04), {
      at: [0, floorY + 0.42, 0.95],
      color: material.wood,
    });
    for (let i = 0; i < 9; i++)
      b.add(roundedBox(0.26, 0.74, 0.04, 0.015), {
        at: [-1.2 + i * 0.3, floorY + 0.42, 1.24],
        color: [material.woodLight, material.wood][i % 2],
        jitter: 0.06,
      });
    b.add(roundedBox(2.9, 0.09, 0.7, 0.03), {
      at: [0, floorY + 0.88, 0.97],
      color: material.woodLight,
    });
    // 계산대 위: 물고기 접시·통조림·사탕 병
    b.add(new CylinderGeometry(0.32, 0.26, 0.05, 20), {
      at: [-0.75, floorY + 0.96, 1.0],
      color: art.paper,
    });
    for (let i = 0; i < 3; i++) {
      const x = -0.86 + i * 0.12,
        z = 0.93 + (i % 2) * 0.12;
      b.add(new SphereGeometry(0.12, 10, 6), {
        at: [x, floorY + 1.02, z],
        rot: [0, 0.5 + i, 0],
        scale: [1, 0.42, 0.45],
        color: i === 1 ? art.butter : "#F59A6B",
      });
      b.add(new ConeGeometry(0.06, 0.1, 3), {
        at: [
          x - Math.cos(0.5 + i) * 0.13,
          floorY + 1.02,
          z + Math.sin(0.5 + i) * 0.13,
        ],
        rot: [0, 0.5 + i, Math.PI / 2],
        scale: [1, 1, 0.4],
        color: i === 1 ? art.butter : "#F59A6B",
      });
    }
    for (let i = 0; i < 3; i++)
      b.add(new CylinderGeometry(0.08, 0.08, 0.12, 12), {
        at: [
          0.75 + (i === 2 ? 0.08 : i * 0.17),
          floorY + 0.99 + (i === 2 ? 0.125 : 0),
          1.0,
        ],
        color: [material.teal, art.sky, material.tealLight][i],
      });
    b.add(new SphereGeometry(0.13, 12, 10), {
      at: [0.25, floorY + 1.06, 0.82],
      color: material.glass,
    });
    for (let i = 0; i < 6; i++)
      b.add(new SphereGeometry(0.035, 6, 4), {
        at: [
          0.25 + Math.cos(i) * 0.06,
          floorY + 1.0 + (i % 3) * 0.04,
          0.82 + Math.sin(i) * 0.06,
        ],
        color: bookTones[i],
      });
    // 지붕(청록 기와)
    const eaveY = floorY + 2.32,
      ridgeY = floorY + 3.15;
    gable(b, 1.68, eaveY, ridgeY, 1.45, material.woodLight, material.woodDark);
    gable(b, -1.68, eaveY, ridgeY, 1.45, material.woodLight, material.woodDark);
    for (const sz of [-1, 1])
      b.add(roundedBox(3.5, 0.18, 0.2, 0.04), {
        at: [0, eaveY + 0.04, sz * 1.38],
        color: material.wood,
      });
    tiledRoof(b, {
      width: 4.2,
      eaveY: eaveY - 0.15,
      ridgeY: ridgeY + 0.05,
      eaveZ: 2.0,
      tones: [
        material.teal,
        material.tealLight,
        material.teal,
        material.tealDark,
      ],
      rows: 6,
      cols: 14,
      board: material.woodDark,
    });
    // 간판: 물고기
    b.add(roundedBox(1.2, 0.46, 0.08, 0.06), {
      at: [0, eaveY + 0.5, 1.95],
      rot: [-0.25, 0, 0],
      color: material.woodLight,
    });
    b.add(new SphereGeometry(0.17, 14, 8), {
      at: [-0.06, eaveY + 0.51, 2.0],
      rot: [-0.25, 0, 0],
      scale: [1.5, 0.75, 0.3],
      color: material.mailRed,
    });
    b.add(new ConeGeometry(0.12, 0.18, 3), {
      at: [0.27, eaveY + 0.51, 1.99],
      rot: [-0.25, 0, -Math.PI / 2],
      scale: [1, 1, 0.3],
      color: material.mailRed,
    });
    b.add(new SphereGeometry(0.025, 6, 4), {
      at: [-0.22, eaveY + 0.55, 2.06],
      color: material.pupil,
    });
    lantern(b, glow, [-1.62, floorY + 1.85, 1.6], 0.18);
    // 앞 화단
    for (const sx of [-1, 1]) {
      b.add(roundedBox(0.7, 0.3, 0.42, 0.04), {
        at: [sx * 1.25, 0.15, 1.95],
        color: material.woodDark,
      });
      b.add(lumpy(0.3, 1, 0.3, 620 + sx), {
        at: [sx * 1.25, 0.38, 1.95],
        scale: [1.2, 0.75, 0.8],
        color: material.leaf,
        softCenter: [sx * 1.25, 0.3, 1.95],
      });
      for (let i = 0; i < 6; i++)
        b.add(new SphereGeometry(0.05, 6, 4), {
          at: [
            sx * 1.25 + (random() - 0.5) * 0.55,
            0.52 + random() * 0.08,
            1.95 + (random() - 0.5) * 0.3,
          ],
          color: i % 2 ? "#FFF4DA" : art.pink,
        });
    }
    // 앞 처마에 드리운 천과 꽃
    const drape = new CylinderGeometry(
      0.5,
      0.5,
      1,
      18,
      1,
      true,
      -Math.PI / 2,
      Math.PI,
    );
    cloth.add(drape, {
      at: [-0.75, eaveY - 0.3, 1.5],
      rot: [0, 0, Math.PI / 2],
      scale: [0.42, 2.0, 0.25],
      color: "#FFF6E4",
    });
    for (let i = 0; i < 7; i++)
      cloth.add(new SphereGeometry(0.06, 6, 4), {
        at: [
          -1.45 + i * 0.3,
          eaveY + 0.02 - Math.sin((i / 6) * Math.PI) * 0.05,
          1.62,
        ],
        color: i % 2 ? art.pink : "#FFF4DA",
      });
    return { solid: b.build(), glow: glow.build(), cloth: cloth.build() };
  });

// 등대: 바위 기초, 흰·주황 줄무늬 탑, 전망 난간, 등불 방. 문은 +Z(광장 쪽).
export const lighthouseParts = () =>
  once("lighthouse", () => {
    const b = new Builder(701),
      glow = new Builder(702);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      if (
        Math.abs(
          Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)),
        ) < 0.45
      )
        continue;
      b.add(lumpy(0.38, 1, 0.35, 710 + i), {
        at: [Math.cos(a) * 1.0, 0.12, Math.sin(a) * 1.0],
        scale: [1.1, 0.7, 1],
        color: material.stone,
        gradient: [0.75, 1.05],
        flat: true,
      });
    }
    b.add(new CylinderGeometry(1.0, 1.08, 0.36, 22), {
      at: [0, 0.18, 0],
      color: material.stoneDark,
    });
    const base = 0.36,
      height = 4.3;
    const bands = [
      material.plaster,
      material.mailRed,
      material.plaster,
      material.mailRed,
      material.plaster,
    ];
    const radiusAt = (y: number) => 0.86 - ((y - base) / height) * 0.26;
    bands.forEach((tone, i) => {
      const y0 = base + (i / bands.length) * height,
        y1 = base + ((i + 1) / bands.length) * height;
      b.add(
        new CylinderGeometry(radiusAt(y1), radiusAt(y0), y1 - y0, 22, 1, true),
        {
          at: [0, (y0 + y1) / 2, 0],
          color: tone,
        },
      );
    });
    // 문과 창
    b.add(roundedBox(0.5, 0.82, 0.14, 0.06), {
      at: [0, base + 0.42, 0.82],
      color: material.woodDeep,
    });
    b.add(roundedBox(0.4, 0.72, 0.1, 0.05), {
      at: [0, base + 0.4, 0.86],
      color: material.wood,
    });
    b.add(new SphereGeometry(0.03, 6, 4), {
      at: [0.12, base + 0.4, 0.92],
      color: material.brass,
    });
    b.add(roundedBox(0.7, 0.1, 0.4, 0.03), {
      at: [0, 0.38, 0.98],
      color: material.stone,
    });
    for (const [y, a] of [
      [1.75, 0.5],
      [2.75, -0.4],
      [3.7, 0.2],
    ]) {
      const r = radiusAt(y) - 0.01;
      b.add(roundedBox(0.26, 0.34, 0.08, 0.03), {
        at: [Math.sin(a) * r, y, Math.cos(a) * r],
        rot: [0, a, 0],
        color: material.woodDark,
      });
      glow.add(roundedBox(0.18, 0.26, 0.06, 0.02), {
        at: [Math.sin(a) * (r + 0.02), y, Math.cos(a) * (r + 0.02)],
        rot: [0, a, 0],
        color: material.glass,
      });
    }
    // 전망대 난간
    const top = base + height;
    b.add(new CylinderGeometry(0.98, 0.72, 0.16, 24), {
      at: [0, top + 0.03, 0],
      color: material.stoneDark,
    });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      b.add(new CylinderGeometry(0.022, 0.022, 0.42, 5), {
        at: [Math.cos(a) * 0.9, top + 0.32, Math.sin(a) * 0.9],
        color: material.woodDeep,
      });
    }
    b.add(new TorusGeometry(0.9, 0.035, 6, 36), {
      at: [0, top + 0.53, 0],
      rot: [Math.PI / 2, 0, 0],
      color: material.woodDeep,
    });
    // 등불 방
    b.add(new CylinderGeometry(0.55, 0.55, 0.1, 18), {
      at: [0, top + 0.16, 0],
      color: material.plaster,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(new CylinderGeometry(0.03, 0.03, 0.78, 5), {
        at: [Math.cos(a) * 0.5, top + 0.58, Math.sin(a) * 0.5],
        color: material.woodDeep,
      });
    }
    glow.add(new CylinderGeometry(0.48, 0.48, 0.74, 18, 1, true), {
      at: [0, top + 0.58, 0],
      color: "#FFE7A8",
    });
    glow.add(new SphereGeometry(0.22, 14, 10), {
      at: [0, top + 0.56, 0],
      color: material.lampGlow,
    });
    b.add(new CylinderGeometry(0.6, 0.6, 0.08, 20), {
      at: [0, top + 0.98, 0],
      color: material.mailRedDark,
    });
    b.add(new ConeGeometry(0.66, 0.72, 20), {
      at: [0, top + 1.36, 0],
      color: material.mailRed,
      gradient: [0.85, 1.05],
    });
    b.add(new SphereGeometry(0.1, 10, 8), {
      at: [0, top + 1.77, 0],
      color: material.brass,
    });
    // 물고기 풍향계
    b.add(new CylinderGeometry(0.015, 0.015, 0.45, 4), {
      at: [0, top + 2.0, 0],
      color: material.woodDeep,
    });
    b.add(new SphereGeometry(0.1, 10, 6), {
      at: [0.02, top + 2.18, 0],
      scale: [1.6, 0.7, 0.25],
      color: art.butter,
    });
    b.add(new ConeGeometry(0.07, 0.12, 3), {
      at: [0.21, top + 2.18, 0],
      rot: [0, 0, -Math.PI / 2],
      scale: [1, 1, 0.3],
      color: art.butter,
    });
    return { solid: b.build(), glow: glow.build() };
  });

// 우체통: 나무 기둥 위 둥근 빨간 우체통과 꽂힌 편지. 투입구는 +Z.
export const mailboxParts = () =>
  once("mailbox", () => {
    const b = new Builder(801);
    b.add(new CylinderGeometry(0.075, 0.095, 0.95, 8), {
      at: [0, 0.47, 0],
      color: material.bark,
      gradient: [0.8, 1.05],
    });
    b.add(roundedBox(0.3, 0.06, 0.3, 0.02), {
      at: [0, 0.96, 0],
      color: material.woodDark,
    });
    const boxY = 1.24;
    b.add(roundedBox(0.52, 0.5, 0.42, 0.06), {
      at: [0, boxY, 0],
      color: material.mailRed,
    });
    b.add(
      new CylinderGeometry(
        0.26,
        0.26,
        0.42,
        18,
        1,
        false,
        Math.PI / 2,
        Math.PI,
      ),
      {
        at: [0, boxY + 0.25, 0],
        rot: [Math.PI / 2, 0, 0],
        color: material.mailRed,
      },
    );
    b.add(roundedBox(0.56, 0.05, 0.46, 0.02), {
      at: [0, boxY - 0.25, 0],
      color: material.mailRedDark,
    });
    b.add(roundedBox(0.28, 0.045, 0.04, 0.015), {
      at: [0, boxY + 0.3, 0.22],
      color: material.pupil,
    });
    b.add(roundedBox(0.2, 0.08, 0.02, 0.01), {
      at: [0, boxY + 0.12, 0.215],
      color: material.plaster,
    });
    b.add(roundedBox(0.4, 0.3, 0.02, 0.03), {
      at: [0, boxY - 0.05, 0.212],
      color: material.mailRedDark,
    });
    b.add(new SphereGeometry(0.025, 6, 4), {
      at: [0.14, boxY - 0.05, 0.23],
      color: material.brass,
    });
    // 투입구에 꽂힌 편지
    b.add(roundedBox(0.2, 0.13, 0.012, 0.005), {
      at: [-0.02, boxY + 0.36, 0.222],
      rot: [0.25, 0, 0.12],
      color: art.paper,
    });
    b.add(roundedBox(0.18, 0.12, 0.012, 0.005), {
      at: [0.05, boxY + 0.35, 0.226],
      rot: [0.3, 0, -0.1],
      color: art.letter,
    });
    // 아래 꽃덤불
    for (let i = 0; i < 3; i++) {
      const a = 0.6 + i * 2.1;
      b.add(lumpy(0.2, 1, 0.3, 820 + i), {
        at: [Math.cos(a) * 0.28, 0.15, Math.sin(a) * 0.28],
        color: material.leaf,
        softCenter: [Math.cos(a) * 0.28, 0.05, Math.sin(a) * 0.28],
      });
      b.add(new SphereGeometry(0.05, 6, 4), {
        at: [Math.cos(a) * 0.3, 0.32, Math.sin(a) * 0.3],
        color: i % 2 ? art.pink : art.butter,
      });
    }
    return { solid: b.build() };
  });
