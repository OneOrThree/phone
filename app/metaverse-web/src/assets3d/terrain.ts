import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
} from "three";
import { CAMPFIRE, TREE_POSITIONS } from "../layout";
import { fbm, noise2, smooth } from "./geometry";
import { material, SEA_LEVEL } from "./palette";
import { heightAt, RX, RZ, shoreWidth } from "./shoreline";
import {
  buildingClearance,
  pathDistance,
  PLAZA_RADIUS,
  STONE_RINGS,
} from "./site";

// 섬 전체를 하나의 극좌표 메시로 만든다. 잔디·광장·길·모래·물속 모래를
// 정점 색으로 칠해 경계가 부드럽고 겹침(z-fighting)이 없다.
const colors = {
  grass: new Color(material.grass),
  grassDeep: new Color(material.grassDeep),
  grassLight: new Color(material.grassLight),
  moss: new Color(material.moss),
  dirt: new Color(material.dirt),
  dirtDark: new Color(material.dirtDark),
  ash: new Color(material.ash),
  sand: new Color(material.sand),
  sandWet: new Color(material.sandWet),
  sandDeep: new Color(material.sandDeep),
  seabed: new Color(material.seabed),
};

function ringRadii() {
  const r: number[] = [0];
  // 땅 위: 약 0.42m 간격
  while (r[r.length - 1] < 1) r.push(Math.min(1, r[r.length - 1] + 0.42 / RX));
  // 물가: 촘촘하게(약 0.11m)
  while (r[r.length - 1] < 1 + 2.4 / RX) r.push(r[r.length - 1] + 0.11 / RX);
  // 물속: 점점 넓게
  let step = 0.25;
  while (r[r.length - 1] < 1 + 14 / RX) {
    r.push(r[r.length - 1] + step / RX);
    step *= 1.18;
  }
  return r;
}

let cached: BufferGeometry | null = null;
export function terrainGeometry() {
  if (cached) return cached;
  const radii = ringRadii().filter((v, i, a) => i === 0 || v > a[i - 1] + 1e-6);
  const segments = 420;
  const count = radii.length * (segments + 1);
  const positions = new Float32Array(count * 3),
    colorArray = new Float32Array(count * 3);
  const c = new Color(),
    tmp = new Color();
  let v = 0;
  for (const rn of radii)
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const x = Math.cos(theta) * rn * RX,
        z = Math.sin(theta) * rn * RZ;
      const u = (rn - 1) * RX;
      const y = heightAt(u, theta);
      positions.set([x, y, z], v * 3);
      paint(c, tmp, x, z, u, theta, y);
      colorArray.set([c.r, c.g, c.b], v * 3);
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
  for (const [tx, tz] of TREE_POSITIONS)
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
  const n1 = fbm(x * 0.09 + 3, z * 0.09 - 7, 3),
    n2 = fbm(x * 0.33 - 11, z * 0.33 + 5, 2),
    fine = noise2(x * 1.7, z * 1.7);
  // 잔디: 큰 얼룩 + 잔 얼룩
  c.copy(colors.grassDeep).lerp(colors.grass, smooth(0.32, 0.62, n1));
  c.lerp(colors.grassLight, smooth(0.55, 0.78, n2) * 0.55);
  c.offsetHSL(0, 0, (fine - 0.5) * 0.025);
  // 숲 바닥
  const forest = 1 - smooth(1.3, 3.6, nearestTree(x, z));
  c.lerp(colors.moss, forest * 0.55);
  // 건물 둘레는 밟혀 흙이 살짝 드러난다
  const worn = 1 - smooth(0.1, 0.9, buildingClearance(x, z));
  // 광장과 길
  const d = Math.hypot(x - CAMPFIRE.x, z - CAMPFIRE.z);
  const plaza =
    1 - smooth(PLAZA_RADIUS - 0.7, PLAZA_RADIUS + 0.35 + n2 * 0.6, d);
  const path = 1 - smooth(-0.3, 0.3 + n2 * 0.35, pathDistance(x, z));
  const ground = Math.max(plaza, path, worn * 0.85);
  if (ground > 0) {
    tmp.copy(colors.dirt).lerp(colors.dirtDark, smooth(0.35, 0.75, n2) * 0.6);
    // 돌길 고리 아래는 조금 더 다져진 색
    for (const ring of STONE_RINGS)
      tmp.lerp(
        colors.dirtDark,
        (1 - smooth(0.2, 0.75, Math.abs(d - ring))) * 0.35,
      );
    tmp.lerp(colors.ash, (1 - smooth(1.6, 2.8, d)) * 0.55);
    c.lerp(tmp, ground);
  }
  // 모래사장: 걷는 타원 안쪽 1~2.5m부터 모래
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
