import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { Builder, lumpy, rng } from "./geometry";
import { material } from "./palette";

const memo = new Map<string, BufferGeometry>();
const once = (key: string, make: () => BufferGeometry) => {
  let g = memo.get(key);
  if (!g) memo.set(key, (g = make()));
  return g;
};

// 풀 한 포기: 휘어진 잎 5장. 아래는 진하고 끝은 밝다.
export const grassTuft = () =>
  once("grass", () => {
    const random = rng(3);
    const pos: number[] = [],
      col: number[] = [],
      nor: number[] = [],
      idx: number[] = [];
    const base = new Color(material.grassDeep).multiplyScalar(0.82),
      tip = new Color(material.grassLight);
    const rows = [0, 0.38, 0.72, 1];
    for (let blade = 0; blade < 6; blade++) {
      const a = (blade / 6) * Math.PI * 2 + random() * 0.6;
      const lean = 0.08 + random() * 0.12,
        h = 0.22 + random() * 0.16,
        w = 0.035 + random() * 0.015;
      const dx = Math.cos(a),
        dz = Math.sin(a);
      const start = pos.length / 3;
      for (const t of rows) {
        const cx = dx * (0.02 + lean * t * t),
          cz = dz * (0.02 + lean * t * t),
          y = h * t,
          half = w * (1 - t) * 0.5 + 0.002;
        pos.push(
          cx - dz * half,
          y,
          cz + dx * half,
          cx + dz * half,
          y,
          cz - dx * half,
        );
        const k = t;
        const c = base.clone().lerp(tip, k);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        nor.push(dx * 0.4, 1, dz * 0.4, dx * 0.4, 1, dz * 0.4);
      }
      for (let r = 0; r < rows.length - 1; r++) {
        const i = start + r * 2;
        idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.normalizeNormals();
    g.computeBoundingSphere();
    return g;
  });

// 꽃잎(흰색 정점: 인스턴스 색이 곱해진다)
export const flowerPetals = () =>
  once("petals", () => {
    const b = new Builder(5);
    const petal = new SphereGeometry(0.05, 8, 5);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.add(petal, {
        at: [Math.cos(a) * 0.052, 0.27, Math.sin(a) * 0.052],
        rot: [0, -a, 0.25],
        scale: [1.1, 0.32, 0.72],
        color: "#ffffff",
      });
    }
    return b.build();
  });
export const flowerStems = () =>
  once("stems", () => {
    const b = new Builder(6);
    b.add(new CylinderGeometry(0.009, 0.012, 0.27, 5), {
      at: [0, 0.135, 0],
      color: material.leafDark,
    });
    b.add(new SphereGeometry(0.032, 8, 6), {
      at: [0, 0.282, 0],
      scale: [1, 0.6, 1],
      color: material.brass,
    });
    for (const s of [-1, 1])
      b.add(new SphereGeometry(0.05, 6, 4), {
        at: [s * 0.04, 0.08, 0],
        rot: [0, 0, s * 0.7],
        scale: [1, 0.25, 0.45],
        color: material.leaf,
      });
    return b.build();
  });

// 덤불: 둥근 덩어리 몇 개를 하나의 부피처럼 음영을 준다.
export const bush = (variant: number) =>
  once(`bush${variant}`, () => {
    const random = rng(20 + variant);
    const b = new Builder(20 + variant);
    const n = 4 + variant;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + random();
      const r = 0.26 + random() * 0.16;
      b.add(lumpy(r, 2, 0.24, 30 + i + variant * 7), {
        at: [
          Math.cos(a) * 0.28,
          r * 0.75 + random() * 0.08,
          Math.sin(a) * 0.24,
        ],
        color: [material.leaf, material.leafDark, material.leafLight][i % 3],
        gradient: [0.78, 1.1],
        softCenter: [0, 0.2, 0],
        softAmount: 0.6,
        jitter: 0.05,
      });
    }
    b.add(lumpy(0.36, 2, 0.2, 77 + variant), {
      at: [0, 0.42, 0],
      color: material.leaf,
      gradient: [0.85, 1.12],
      softCenter: [0, 0.2, 0],
      softAmount: 0.6,
    });
    // 작은 꽃송이
    if (variant !== 1)
      for (let i = 0; i < 6; i++) {
        const a = random() * Math.PI * 2;
        b.add(new SphereGeometry(0.045, 6, 4), {
          at: [Math.cos(a) * 0.42, 0.35 + random() * 0.32, Math.sin(a) * 0.38],
          color: variant === 0 ? material.blush : "#FFF6DA",
        });
      }
    return b.build();
  });

// 납작한 디딤돌
export const paver = () =>
  once("paver", () => {
    const b = new Builder(9);
    b.add(lumpy(0.3, 1, 0.22, 91), {
      scale: [1, 0.16, 0.85],
      color: material.stone,
      gradient: [0.85, 1.08],
      flat: true,
    });
    return b.build();
  });

export const rock = (variant: number) =>
  once(`rock${variant}`, () => {
    const b = new Builder(60 + variant);
    b.add(lumpy(1, 1, 0.42 + variant * 0.08, 61 + variant * 13), {
      scale: [1, 0.8, 0.9],
      color: material.stone,
      gradient: [0.62, 1.12],
      flat: true,
    });
    // 물에 닿는 아랫부분의 이끼 띠
    const g = b.build();
    const p = g.getAttribute("position") as BufferAttribute,
      c = g.getAttribute("color") as BufferAttribute;
    const moss = new Color(material.stoneMoss);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0.05) {
        const k = Math.min(1, (0.05 - y) / 0.45);
        c.setXYZ(
          i,
          c.getX(i) + (moss.r - c.getX(i)) * k,
          c.getY(i) + (moss.g - c.getY(i)) * k,
          c.getZ(i) + (moss.b - c.getZ(i)) * k,
        );
      }
    }
    return g;
  });

// 둥근 활엽수. 높이 약 3.6(크기 1 기준), 수관 반경 약 1.35.
export const broadleaf = (variant: number) =>
  once(`broadleaf${variant}`, () => {
    const random = rng(100 + variant);
    const b = new Builder(100 + variant);
    b.add(new CylinderGeometry(0.15, 0.25, 1.75, 9, 3), {
      at: [0, 0.87, 0],
      color: material.bark,
      gradient: [0.75, 1.05],
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      b.add(new ConeGeometry(0.12, 0.42, 6), {
        at: [Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2],
        rot: [Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1],
        color: material.bark,
        gradient: [0.7, 0.95],
      });
    }
    for (const s of [-1, 1])
      b.add(new CylinderGeometry(0.05, 0.09, 0.8, 6), {
        at: [s * 0.28, 1.75, 0.05 * s],
        rot: [0, 0, -s * 0.65],
        color: material.bark,
      });
    const blobs: [number, number, number, number][] = [
      [0, 2.45, 0, 1.0],
      [-0.66, 2.1, 0.25, 0.68],
      [0.64, 2.2, -0.18, 0.72],
      [0.12, 2.05, 0.68, 0.62],
      [-0.15, 2.1, -0.66, 0.6],
      [-0.28, 3.0, -0.2, 0.58],
      [0.36, 2.92, 0.3, 0.52],
    ];
    const tones = [material.leaf, material.leafDark, material.leafLight];
    blobs.forEach(([x, y, z, r], i) => {
      const k = 0.9 + random() * 0.2;
      b.add(lumpy(r * k, 2, 0.24, 300 + variant * 17 + i), {
        at: [x * (0.9 + variant * 0.06), y, z],
        color: tones[(i + variant) % 3],
        gradient: [0.74, 1.12],
        softCenter: [0, 2.4, 0],
        softAmount: 0.8,
        jitter: 0.05,
      });
    });
    // 열매·꽃 점
    if (variant === 0 || variant === 2)
      for (let i = 0; i < 7; i++) {
        const a = random() * Math.PI * 2,
          y = 2.0 + random() * 1.0;
        const rr = 1.05 - Math.abs(y - 2.45) * 0.35;
        b.add(new SphereGeometry(0.07, 7, 5), {
          at: [Math.cos(a) * rr, y, Math.sin(a) * rr],
          color: variant === 0 ? material.blush : "#FFF1C2",
        });
      }
    return b.build();
  });

// 원뿔 층을 쌓은 침엽수. 높이 약 3.9, 아래 층 반경 1.0.
export const pine = (variant: number) =>
  once(`pine${variant}`, () => {
    const b = new Builder(200 + variant);
    b.add(new CylinderGeometry(0.11, 0.18, 1.3, 7), {
      at: [0, 0.65, 0],
      color: material.bark,
      gradient: [0.75, 1],
    });
    const tiers: [number, number, number][] = [
      [1.0, 1.25, 1.35],
      [0.82, 1.1, 2.0],
      [0.63, 0.95, 2.6],
      [0.42, 0.8, 3.15],
    ];
    const tones = [
      material.pineDark,
      material.pine,
      material.pine,
      material.pineLight,
    ];
    tiers.forEach(([r, h, y], i) => {
      const cone = new ConeGeometry(r * (1 + variant * 0.06), h, 11, 2);
      // 아래 테두리를 살짝 늘어뜨린다
      const p = cone.getAttribute("position") as BufferAttribute;
      for (let v = 0; v < p.count; v++)
        if (p.getY(v) < -h / 2 + 0.01)
          p.setY(v, p.getY(v) - 0.06 * Math.sin(v * 1.7) ** 2);
      cone.computeVertexNormals();
      b.add(cone, {
        at: [0, y, 0],
        rot: [0, i * 0.4, 0],
        color: tones[i],
        gradient: [0.72, 1.1],
      });
    });
    return b.build();
  });

// 떠 있는 둥근 구름 같은 형태는 쓰지 않고, 바닥에 붙는 잎 무더기(고사리)만 둔다.
export const fern = () =>
  once("fern", () => {
    const b = new Builder(12);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.add(new SphereGeometry(0.2, 7, 4), {
        at: [Math.cos(a) * 0.18, 0.1, Math.sin(a) * 0.18],
        rot: [0, -a, 0.55],
        scale: [1.2, 0.18, 0.42],
        color: material.leafDark,
        gradient: [0.8, 1.15],
      });
    }
    return b.build();
  });

// 늘어진 버드나무. 둥근 수관 가장자리에서 가는 잎 줄기가 1.2m 높이까지 늘어진다. 높이 약 3.5.
export const willow = (variant: number) =>
  once(`willow${variant}`, () => {
    const random = rng(400 + variant);
    const b = new Builder(400 + variant);
    b.add(new CylinderGeometry(0.14, 0.27, 2.3, 9, 3), {
      at: [0, 1.12, 0],
      rot: [0, 0, 0.07 * (variant ? -1 : 1)],
      color: material.bark,
      gradient: [0.72, 1.05],
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.9;
      b.add(new ConeGeometry(0.13, 0.45, 6), {
        at: [Math.cos(a) * 0.22, 0.12, Math.sin(a) * 0.22],
        rot: [Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1],
        color: material.bark,
        gradient: [0.7, 0.95],
      });
    }
    const crown: [number, number, number, number][] = [
      [0, 2.75, 0, 0.9],
      [-0.55, 2.55, 0.22, 0.62],
      [0.55, 2.6, -0.18, 0.64],
      [0.1, 3.1, 0.1, 0.56],
      [-0.1, 2.6, -0.6, 0.55],
    ];
    crown.forEach(([x, y, z, r], i) =>
      b.add(lumpy(r, 2, 0.22, 420 + variant * 11 + i), {
        at: [x, y, z],
        color: i % 2 ? material.leafLight : material.leaf,
        gradient: [0.8, 1.12],
        softCenter: [0, 2.7, 0],
        softAmount: 0.75,
        jitter: 0.05,
      }),
    );
    const strands = 30;
    for (let i = 0; i < strands; i++) {
      const a = (i / strands) * Math.PI * 2 + random() * 0.18;
      const r0 = 0.72 + random() * 0.32,
        top = 2.55 + random() * 0.45,
        drop = 1.05 + random() * 0.55;
      const dx = Math.cos(a),
        dz = Math.sin(a);
      const curve = new CatmullRomCurve3([
        new Vector3(dx * r0, top, dz * r0),
        new Vector3(dx * (r0 + 0.28), top - 0.25, dz * (r0 + 0.28)),
        new Vector3(dx * (r0 + 0.36), top - drop * 0.6, dz * (r0 + 0.36)),
        new Vector3(dx * (r0 + 0.38), top - drop, dz * (r0 + 0.38)),
      ]);
      b.add(new TubeGeometry(curve, 6, 0.045 + random() * 0.02, 4, false), {
        color: i % 3 === 0 ? material.leafLight : material.leaf,
        gradient: [0.82, 1.1],
        jitter: 0.06,
      });
    }
    return b.build();
  });
