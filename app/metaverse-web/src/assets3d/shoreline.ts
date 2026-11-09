import { ISLAND } from "../layout";
import { GROUND_Y, SEA_LEVEL } from "./palette";

// 섬 지형의 단면. 걷는 타원(layout ISLAND.radiusX/Z) 안은 평평한 땅이고,
// 그 바깥에서 모래 비탈이 물가(shoreRadius)까지 내려간 뒤 물속으로 이어진다.
// 지형 메시와 바다 셰이더가 같은 식을 써서 해안선과 포말이 어긋나지 않는다.
export const RX = ISLAND.radiusX;
export const RZ = ISLAND.radiusZ;
export const SHORE_BASE = ISLAND.shoreRadius - ISLAND.radiusX;
const DROP = GROUND_Y - SEA_LEVEL;
const DEEP = 2.4;
// 정수 주파수만 써서 한 바퀴를 돌아도 이음매가 없다.
const WOBBLE: [number, number, number][] = [
  [0.22, 3, 0.6],
  [0.14, 5, 2.1],
  [0.08, 9, 4.0],
  [0.05, 14, 1.3],
];

export function polar(x: number, z: number) {
  const nx = x / RX,
    nz = z / RZ;
  return { rn: Math.hypot(nx, nz), theta: Math.atan2(nz, nx) };
}
export function shoreWidth(theta: number) {
  let w = 0;
  for (const [a, k, p] of WOBBLE) w += a * Math.sin(k * theta + p);
  return SHORE_BASE * (1 + w);
}
// u: 걷는 타원 가장자리에서 바깥쪽으로 잰 거리(대략 m)
export function heightAt(u: number, theta: number) {
  if (u <= 0) return GROUND_Y;
  const w = shoreWidth(theta);
  if (u <= w) return GROUND_Y - DROP * Math.pow(u / w, 1.25);
  const k = (DROP * 1.25) / (w * DEEP);
  return SEA_LEVEL - DEEP * (1 - Math.exp(-(u - w) * k));
}
export function terrainHeight(x: number, z: number) {
  const { rn, theta } = polar(x, z);
  return heightAt((rn - 1) * RX, theta);
}
// 물가에서 바다 쪽으로의 거리. 음수면 땅이다.
export function shoreDistance(x: number, z: number) {
  const { rn, theta } = polar(x, z);
  return (rn - 1) * RX - shoreWidth(theta);
}

const f = (n: number) => n.toFixed(5);
export const shoreGLSL = /* glsl */ `
float shoreWidth(float t) {
  float w = 0.0;
  ${WOBBLE.map(([a, k, p]) => `w += ${f(a)} * sin(${f(k)} * t + ${f(p)});`).join("\n  ")}
  return ${f(SHORE_BASE)} * (1.0 + w);
}
vec3 shoreInfo(vec2 p) {
  vec2 n = vec2(p.x / ${f(RX)}, p.y / ${f(RZ)});
  float t = atan(n.y, n.x);
  float u = (length(n) - 1.0) * ${f(RX)};
  float w = shoreWidth(t);
  float h;
  if (u <= 0.0) h = ${f(GROUND_Y)};
  else if (u <= w) h = ${f(GROUND_Y)} - ${f(DROP)} * pow(u / w, 1.25);
  else {
    float k = ${f(DROP * 1.25)} / (w * ${f(DEEP)});
    h = ${f(SEA_LEVEL)} - ${f(DEEP)} * (1.0 - exp(-(u - w) * k));
  }
  // x: 물가에서의 거리, y: 수심, z: 각도
  return vec3(u - w, ${f(SEA_LEVEL)} - h, t);
}
`;
