import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
} from "three";
import { FOCUS_LANDMARKS, FOCUS_TREE_POSITIONS } from "../layout";
import { fbm, noise2, smooth } from "./geometry";
import { GROUND_Y, material, SEA_LEVEL } from "./palette";
import {
  bankHeight,
  FRIEND_SEATS_DIRT,
  focusPathDistance,
  ISLET,
  nearestSeat,
  plungeCut,
  POND,
  POND_LEVEL,
  pondBed,
  pondR,
  streamCut,
  PLUNGE,
} from "./pond";
import { heightAt, polar, RX, RZ, shoreWidth } from "./shoreline";

// 낚시섬 지형. 일반 섬과 같은 극좌표 메시·같은 해안 단면(shoreline.ts)을 쓰고,
// 가운데에 실제로 파인 연못(물가 비탈·바닥·가운데 작은 섬)과 북쪽 폭포 소·물길을 새긴다.
// 걷는 곳(물가 길·의자 자리·풀밭)은 모두 GROUND_Y로 평평하다.
const c = (hex: string) => new Color(hex);
const colors = {
  grass: c(material.grass),
  grassDeep: c(material.grassDeep),
  grassLight: c(material.grassLight),
  moss: c(material.moss),
  dirt: c(material.dirt),
  dirtDark: c(material.dirtDark),
  gravel: c("#E4D3AE"),
  bankEarth: c("#B9B08A"),
  mud: c("#9C9C78"),
  pondBed: c("#7FA592"),
  pondDeep: c("#5E8C84"),
  stone: c(material.stoneDark),
  sand: c(material.sand),
  sandWet: c(material.sandWet),
  sandDeep: c(material.sandDeep),
  seabed: c(material.seabed),
};

export function focusHeight(x: number, z: number) {
  const { rn, theta } = polar(x, z);
  let h = heightAt((rn - 1) * RX, theta);
  const r = pondR(x, z);
  if (r < POND.bank) h = r < POND.radius - 0.06 ? pondBed(x, z) : bankHeight(r);
  return Math.min(h, streamCut(x, z), plungeCut(x, z));
}

function ringRadii() {
  // 반경(정규화 rn)마다 다른 간격. 물가 비탈은 6cm, 땅은 25cm, 바다 쪽은 점점 넓게.
  const out: number[] = [0];
  const push = (to: number, metres: number) => {
    while (out[out.length - 1] < to - 1e-6)
      out.push(Math.min(to, out[out.length - 1] + metres / RX));
  };
  // 가운데 작은 섬의 물가 비탈은 촘촘하게(10cm) 잘라 물가선이 각지지 않게 한다.
  push((ISLET.flat - 0.1) / RX, 0.3);
  push((ISLET.foot + 0.1) / RX, 0.1);
  push(9.9 / RX, 0.3);
  push(11.85 / RZ, 0.055);
  push(1, 0.25);
  push(1 + 2.4 / RX, 0.11);
  let step = 0.25;
  while (out[out.length - 1] < 1 + 14 / RX) {
    out.push(out[out.length - 1] + step / RX);
    step *= 1.18;
  }
  return out;
}

let cached: BufferGeometry | null = null;
export function focusTerrainGeometry() {
  if (cached) return cached;
  const radii = ringRadii();
  const segments = 640;
  const count = radii.length * (segments + 1);
  const positions = new Float32Array(count * 3),
    colorArray = new Float32Array(count * 3);
  const col = new Color(),
    tmp = new Color();
  let v = 0;
  for (const rn of radii)
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const x = Math.cos(theta) * rn * RX,
        z = Math.sin(theta) * rn * RZ;
      const y = focusHeight(x, z);
      positions.set([x, y, z], v * 3);
      paint(col, tmp, x, z, (rn - 1) * RX, theta, y);
      colorArray.set([col.r, col.g, col.b], v * 3);
      v++;
    }
  const index: number[] = [];
  for (let i = 0; i < radii.length - 1; i++)
    for (let s = 0; s < segments; s++) {
      const a = i * (segments + 1) + s,
        b = a + 1,
        d = a + segments + 1,
        e = d + 1;
      index.push(a, b, d, b, e, d);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new Float32BufferAttribute(colorArray, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(index), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  cached = g;
  return g;
}

function nearestTree(x: number, z: number) {
  let best = 99;
  for (const [tx, tz] of FOCUS_TREE_POSITIONS)
    best = Math.min(best, Math.hypot(tx - x, tz - z));
  return best;
}

function paint(
  c: Color,
  tmp: Color,
  x: number,
  z: number,
  u: number,
  theta: number,
  y: number,
) {
  const n1 = fbm(x * 0.09 + 13, z * 0.09 - 2, 3),
    n2 = fbm(x * 0.33 - 4, z * 0.33 + 11, 2),
    fine = noise2(x * 1.7, z * 1.7);
  // 잔디: 일반 섬보다 조금 더 촉촉한 초록
  c.copy(colors.grassDeep).lerp(colors.grass, smooth(0.3, 0.64, n1));
  c.lerp(colors.grassLight, smooth(0.55, 0.8, n2) * 0.45);
  c.offsetHSL(0, 0, (fine - 0.5) * 0.025);
  c.lerp(colors.moss, (1 - smooth(1.3, 3.6, nearestTree(x, z))) * 0.55);
  const r = pondR(x, z);
  // 물가 길: 연못 둘레의 밝은 자갈 흙. 가장자리는 노이즈로 풀과 섞인다.
  const ring =
    smooth(POND.bank - 0.35, POND.bank + 0.05, r) *
    (1 - smooth(POND.path - 0.05, POND.path + 0.45 + n2 * 0.5, r));
  // 의자 자리: 다져진 흙
  const seat = 1 - smooth(0.42, 0.78 + n2 * 0.2, nearestSeat(x, z));
  const path = 1 - smooth(-0.3, 0.3 + n2 * 0.35, focusPathDistance(x, z));
  const shelter = FOCUS_LANDMARKS.shelter,
    gram = FOCUS_LANDMARKS.gramophone;
  const worn = Math.max(
    1 - smooth(1.3, 2.1, Math.hypot(x - shelter.x, z - shelter.z)),
    1 - smooth(0.7, 1.15, Math.hypot(x - gram.x, z - gram.z)),
  );
  const ground = Math.max(ring, path, seat * 0.9, worn * 0.8);
  if (ground > 0) {
    tmp.copy(colors.gravel).lerp(colors.dirt, smooth(0.3, 0.7, n2) * 0.6);
    tmp.lerp(colors.dirtDark, seat * 0.35);
    c.lerp(tmp, ground);
  }
  // 물가 비탈과 연못 바닥: 젖은 흙 → 물속 모래 → 깊은 바닥
  if (r < POND.bank + 0.1) {
    const wet = smooth(POND.bank + 0.05, POND.radius + 0.1, r);
    tmp.copy(colors.bankEarth).lerp(colors.mud, wet * 0.7);
    if (y < POND_LEVEL) {
      const depth = POND_LEVEL - y;
      tmp.copy(colors.sandWet).lerp(colors.pondBed, smooth(0.02, 0.35, depth));
      tmp.lerp(colors.pondDeep, smooth(0.4, 0.95, depth));
      tmp.offsetHSL(0, 0, (fine - 0.5) * 0.04);
    }
    c.lerp(tmp, smooth(POND.bank + 0.1, POND.bank - 0.25, r));
  }
  // 가운데 작은 섬: 물 위로 나온 부분은 이끼 낀 풀, 친구 의자 아래는 다져진 흙
  if (r < ISLET.foot && y > POND_LEVEL + 0.01) {
    c.copy(colors.moss).lerp(colors.grassDeep, smooth(0.4, 0.9, n2));
    c.lerp(colors.grassLight, smooth(0.55, 0.8, n1) * 0.35);
    const worn = 1 - smooth(0.42, 0.78 + n2 * 0.2, FRIEND_SEATS_DIRT(x, z));
    if (worn > 0) {
      tmp.copy(colors.dirt).lerp(colors.dirtDark, 0.35);
      c.lerp(tmp, worn * 0.85);
    }
  }
  // 물길과 소: 돌 바닥
  const cut = Math.min(plungeCut(x, z), streamCut(x, z));
  if (cut < GROUND_Y + 0.015) {
    const k = smooth(GROUND_Y + 0.015, GROUND_Y - 0.06, cut);
    tmp
      .copy(colors.stone)
      .lerp(colors.pondBed, smooth(0.0, 0.18, GROUND_Y - 0.1 - cut));
    tmp.offsetHSL(0, 0, (fine - 0.5) * 0.06);
    c.lerp(tmp, k);
  }
  const plunge = Math.hypot(x - PLUNGE.x, z - PLUNGE.z);
  if (plunge < PLUNGE.radius + 0.6)
    c.lerp(
      colors.stone,
      (1 - smooth(PLUNGE.radius, PLUNGE.radius + 0.6, plunge)) * 0.5,
    );
  // 바깥 모래사장(일반 섬과 같은 규칙)
  const grassEdge =
    -1.25 - 1.3 * fbm(Math.cos(theta) * 2.3 + 9, Math.sin(theta) * 2.3, 2);
  const sand = smooth(grassEdge - 0.3, grassEdge + 0.3, u);
  if (sand > 0) {
    tmp.copy(colors.sand).offsetHSL(0, 0, (fine - 0.5) * 0.03);
    const w = shoreWidth(theta);
    tmp.lerp(colors.sandWet, smooth(w - 0.75, w - 0.05, u));
    if (y < SEA_LEVEL) {
      const depth = SEA_LEVEL - y;
      tmp.copy(colors.sandWet).lerp(colors.sandDeep, smooth(0, 0.5, depth));
      tmp.lerp(colors.seabed, smooth(0.5, 2.2, depth));
    }
    c.lerp(tmp, sand);
  }
}
