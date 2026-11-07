import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  NormalBlending,
  RingGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from "three";
import { FOCUS_SEATS } from "../layout";
import { material } from "./palette";
import {
  FALL_LIP,
  PLUNGE,
  POND,
  POND_LEVEL,
  STREAM,
  STREAM_Z0,
  STREAM_Z1,
  streamLevel,
  streamX,
} from "./pond";

// 낚시섬의 민물: 연못 수면, 폭포 아래 소, 물길, 폭포 물줄기, 물보라.
// 모두 하나의 시간(waterTime)을 공유하고, 동작 줄이기에서는 FocusIsland가 시간을 고정한다.
export const waterTime = { value: 0 };
const SUN = new Vector3(-18, 34, 20).normalize();
const f = (n: number) => n.toFixed(4);

const noiseGLSL = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = r * p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v;
}
`;

const flatVertex = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

// 연못·소 공통 셰이더. 깊이는 지형(pond.ts)과 같은 반경 식으로 근사한다.
// kind 0 = 연못(바람 물결·물길 유입 물결·가끔 물고기 동그라미), 1 = 폭포 소(떨어지는 물의 거품).
const pondFragment = (kind: 0 | 1) => /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uBank;
uniform vec3 uSun;
uniform vec2 uCenter;
uniform vec2 uInflow;
uniform vec2 uFloats[${FOCUS_SEATS.length}];
varying vec3 vWorld;
#include <fog_pars_fragment>
${noiseGLSL}
float depthAt(vec2 p) {
  float r = length(p - uCenter);
${
  kind === 0
    ? `  float d = 0.06 + 0.95 * (1.0 - smoothstep(7.2, ${f(POND.radius - 0.06)}, r));
  // 가운데 작은 섬
  d = min(d, mix(-0.24, 0.7, smoothstep(0.69, 2.35, r)));
  return d;`
    : `  return 0.02 + 0.28 * (1.0 - smoothstep(${f(PLUNGE.radius * 0.45)}, ${f(PLUNGE.radius + 0.3)}, r));`
}
}
// 바람 물결: 두 겹 노이즈 높이의 기울기
float waves(vec2 p, float t) {
  return noise(p * 1.7 + vec2(t * 0.22, t * 0.16)) * 0.6
    + noise(p * 3.9 - vec2(t * 0.35, -t * 0.27)) * 0.4;
}
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float r = length(p - uCenter);
  float depth = depthAt(p);
  float dist = length(cameraPosition - vWorld);
  float near = 1.0 - smoothstep(16.0, 60.0, dist);
  // 바람이 지나가는 자리만 물결이 선다(넓은 노이즈로 세기를 바꾼다)
  float gust = smoothstep(0.25, 0.75, fbm(p * 0.12 + vec2(t * 0.05, -t * 0.03)));
  float e = 0.06;
  vec2 g = vec2(waves(p + vec2(e, 0.0), t) - waves(p - vec2(e, 0.0), t),
    waves(p + vec2(0.0, e), t) - waves(p - vec2(0.0, e), t)) / (2.0 * e);
  g *= (0.025 + 0.05 * gust) * (0.55 + 0.45 * near);
  float foam = 0.0;
${
  kind === 0
    ? `  // 물길이 들어오는 곳에서 퍼지는 동심 물결과 거품
  vec2 dv = p - uInflow;
  float di = length(dv);
  float ring = cos(di * 8.5 - t * 2.4) * exp(-di * 0.7) * smoothstep(0.05, 0.5, di);
  g += normalize(dv + 1e-4) * ring * 0.09;
  foam += (1.0 - smoothstep(0.1, 1.15, di)) * smoothstep(0.45, 0.75, noise(p * 4.0 + vec2(0.0, t * 0.9)));
  // 찌 둘레의 잔물결(찌가 있든 없든 의자 앞 수면이 숨 쉬듯 흔들린다)
  for (int i = 0; i < ${FOCUS_SEATS.length}; i++) {
    vec2 q = p - uFloats[i];
    float dq = length(q);
    if (dq < 0.9) {
      float w = cos(dq * 22.0 - t * 3.0 + float(i)) * (1.0 - smoothstep(0.15, 0.9, dq)) * smoothstep(0.06, 0.16, dq);
      g += normalize(q + 1e-4) * w * 0.035;
    }
  }
  // 가끔 물고기가 뛰어 생기는 동그라미 두 개(위치·시각은 시간 칸마다 정한 난수)
  for (int k = 0; k < 2; k++) {
    float slot = floor(t / 6.5 + float(k) * 0.5);
    float age = fract(t / 6.5 + float(k) * 0.5) * 6.5;
    float a = hash(vec2(slot, float(k) + 3.0)) * 6.2832;
    float rr = mix(3.0, 8.3, hash(vec2(float(k) + 1.0, slot)));
    vec2 c = uCenter + vec2(sin(a), cos(a)) * rr;
    float dc = length(p - c);
    float front = age * 0.55;
    float band = exp(-pow((dc - front) * 7.0, 2.0)) * (1.0 - smoothstep(0.0, 3.2, age));
    g += normalize(p - c + 1e-4) * band * 0.12;
  }`
    : `  // 폭포가 떨어지는 자리: 소용돌이 거품과 퍼지는 물결
  vec2 dv = p - uInflow;
  float di = length(dv);
  float churn = fbm(p * 3.2 + vec2(t * 0.8, -t * 1.1));
  foam += (1.0 - smoothstep(0.15, 0.85, di)) * (0.55 + 0.45 * churn);
  foam += smoothstep(0.62, 0.8, noise(p * 5.0 + t * 0.7)) * 0.35;
  float ring = cos(di * 11.0 - t * 4.2) * exp(-di * 1.4);
  g += normalize(dv + 1e-4) * ring * 0.12;`
}
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.03, 0.7, depth));
  col *= 1.0 - 0.18 * smoothstep(0.5, 1.0, depth);
  // 얕은 곳의 물빛 무늬
  float caustic = smoothstep(0.6, 0.82, fbm(p * 1.3 + vec2(t * 0.1, t * 0.07))) * (1.0 - smoothstep(0.05, 0.6, depth));
  col += uFoam * caustic * 0.14;
  // 반사: 낮은 각도에서는 물가 풀·나무 빛, 높은 각도는 하늘
  vec3 refl = reflect(-v, n);
  float trees = smoothstep(0.35, 0.7, noise(vec2(atan(refl.z, refl.x) * 3.0, 0.0)));
  vec3 env = mix(uBank * (0.85 + 0.25 * trees), uSky, smoothstep(0.05, 0.42, refl.y));
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
  col = mix(col, env, clamp(0.06 + fres * 1.15, 0.0, 0.72));
  vec3 h = normalize(uSun + v);
  float spec = pow(max(dot(n, h), 0.0), 220.0);
  float sp = noise(p * 2.4 + vec2(t * 0.21, t * 0.11)) * noise(p * 3.1 - vec2(t * 0.17, -t * 0.2));
  float glint = smoothstep(0.58, 0.76, sp) * 0.16 * near;
  // 물가선의 젖은 띠
  float edge = 1.0 - smoothstep(0.0, 0.14 + 0.05 * sin(t * 0.8 + p.x), abs(${f(kind === 0 ? POND.radius + 0.03 : PLUNGE.radius + 0.05)} - r));
  foam = clamp(max(foam, edge * 0.55 * (0.6 + 0.4 * noise(p * 3.0 + t * 0.2))), 0.0, 1.0);
  col = mix(col, uFoam, foam * 0.85);
  col += uFoam * (spec * 0.55 + glint);
  float alpha = mix(0.5, 0.94, smoothstep(0.0, 0.55, depth));
  alpha = max(alpha, foam * 0.92);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function waterUniforms(extra: Record<string, { value: unknown }>) {
  return UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: waterTime,
      uDeep: { value: new Color(material.pondDeep) },
      uShallow: { value: new Color(material.pondShallow) },
      uFoam: { value: new Color(material.seaFoam) },
      uSky: { value: new Color(material.seaSky) },
      uBank: { value: new Color(material.pondBank) },
      uSun: { value: SUN.clone() },
      ...extra,
    },
  ]);
}
// UniformsUtils.merge가 값을 복제하므로 시간은 공유 객체로 다시 묶는다.
function shareTime(m: ShaderMaterial) {
  m.uniforms.uTime = waterTime;
  return m;
}

let pondMaterial: ShaderMaterial | null = null;
let poolMaterial: ShaderMaterial | null = null;
// 찌가 떨어지는 자리(의자 앞 3.5m). catPose.ts의 FOCUS_CAST와 같은 반경이다.
const FLOAT_RADIUS = 13.2 - 3.5;
function pondShader() {
  pondMaterial ??= shareTime(
    new ShaderMaterial({
      uniforms: waterUniforms({
        uCenter: { value: new Vector2(POND.x, POND.z) },
        uInflow: { value: new Vector2(streamX(STREAM_Z1), STREAM_Z1 + 0.1) },
        uFloats: {
          value: FOCUS_SEATS.map((s) => {
            const r = Math.hypot(s.x, s.z);
            return new Vector2(
              (s.x / r) * FLOAT_RADIUS,
              (s.z / r) * FLOAT_RADIUS,
            );
          }),
        },
      }),
      vertexShader: flatVertex,
      fragmentShader: pondFragment(0),
      fog: true,
      transparent: true,
      depthWrite: false,
    }),
  );
  return pondMaterial;
}
function poolShader() {
  poolMaterial ??= shareTime(
    new ShaderMaterial({
      uniforms: waterUniforms({
        uCenter: { value: new Vector2(PLUNGE.x, PLUNGE.z) },
        uInflow: { value: new Vector2(FALL_LIP.x, FALL_LIP.z + 0.6) },
        uFloats: { value: FOCUS_SEATS.map(() => new Vector2(999, 999)) },
      }),
      vertexShader: flatVertex,
      fragmentShader: pondFragment(1),
      fog: true,
      transparent: true,
      depthWrite: false,
    }),
  );
  return poolMaterial;
}
let pondDisc: BufferGeometry | null = null;
let poolDisc: BufferGeometry | null = null;
const disc = (radius: number, segments: number, rings: number) =>
  new RingGeometry(0, radius, segments, rings).rotateX(-Math.PI / 2);

// 흐르는 물(물길·폭포) 셰이더: uv.x는 가로(0~1), uv.y는 흐름 방향 거리(m). aFall은 물이 떨어지는 정도.
const flowVertex = /* glsl */ `
attribute float aFall;
varying vec2 vUv;
varying float vFall;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vFall = aFall;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const flowFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform float uSpeed;
uniform float uCurtain;
varying vec2 vUv;
varying float vFall;
varying vec3 vWorld;
#include <fog_pars_fragment>
${noiseGLSL}
void main() {
  float t = uTime;
  float along = vUv.y - t * (uSpeed + vFall * 2.6);
  // 흐름 방향으로 길게 늘어난 줄무늬
  float streak = noise(vec2(vUv.x * mix(9.0, 16.0, uCurtain), along * mix(1.6, 0.9, uCurtain)));
  float fine = noise(vec2(vUv.x * 28.0, along * 4.0));
  float white = smoothstep(0.5, 0.85, streak * 0.7 + fine * 0.3);
  vec3 col = mix(uShallow, uDeep, 0.35 - 0.25 * uCurtain);
  vec3 v = normalize(cameraPosition - vWorld);
  col = mix(col, uSky, 0.18 + 0.2 * uCurtain);
  float foam = white * (0.35 + 0.65 * max(vFall, uCurtain));
  // 물길 가장자리의 흰 테두리
  float side = smoothstep(0.32, 0.5, abs(vUv.x - 0.5));
  foam = max(foam, side * (0.25 + 0.3 * fine) * (1.0 - uCurtain));
  col = mix(col, uFoam, clamp(foam, 0.0, 1.0));
  float alpha = mix(0.82, 0.9, foam);
  // 폭포 물줄기 양옆은 얇게 사라진다
  alpha *= mix(1.0, 1.0 - smoothstep(0.36, 0.5, abs(vUv.x - 0.5)), uCurtain);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
const flowMaterials = new Map<string, ShaderMaterial>();
function flowShader(curtain: boolean) {
  const key = curtain ? "curtain" : "stream";
  let m = flowMaterials.get(key);
  if (!m) {
    m = shareTime(
      new ShaderMaterial({
        uniforms: waterUniforms({
          uSpeed: { value: curtain ? 2.4 : 0.9 },
          uCurtain: { value: curtain ? 1 : 0 },
        }),
        vertexShader: flowVertex,
        fragmentShader: flowFragment,
        fog: true,
        transparent: true,
        depthWrite: false,
        ...(curtain ? { side: DoubleSide } : {}),
        blending: NormalBlending,
      }),
    );
    flowMaterials.set(key, m);
  }
  return m;
}

// 띠 메시: 중심선 점들(위치·옆 방향·폭·떨어지는 정도)로 만든다.
function ribbon(
  rows: { at: Vector3; side: Vector3; width: number; fall: number }[],
  columns = 6,
) {
  const pos: number[] = [],
    uv: number[] = [],
    fall: number[] = [],
    index: number[] = [];
  let length = 0;
  rows.forEach((row, i) => {
    if (i > 0) length += row.at.distanceTo(rows[i - 1].at);
    for (let c = 0; c <= columns; c++) {
      const u = c / columns;
      const p = row.at.clone().addScaledVector(row.side, (u - 0.5) * row.width);
      pos.push(p.x, p.y, p.z);
      uv.push(u, length);
      fall.push(row.fall);
    }
  });
  for (let i = 0; i < rows.length - 1; i++)
    for (let c = 0; c < columns; c++) {
      const a = i * (columns + 1) + c,
        b = a + 1,
        d = a + columns + 1,
        e = d + 1;
      index.push(a, b, d, b, e, d);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("aFall", new Float32BufferAttribute(fall, 1));
  g.setIndex(new BufferAttribute(new Uint32Array(index), 1));
  g.computeBoundingSphere();
  return g;
}

let streamRibbon: BufferGeometry | null = null;
// 소에서 연못까지의 물길 수면. 지형 홈보다 넓게 깔고 땅이 높은 곳은 깊이 시험으로 가려진다.
function streamGeometry() {
  if (streamRibbon) return streamRibbon;
  const rows: { at: Vector3; side: Vector3; width: number; fall: number }[] =
    [];
  const z0 = STREAM_Z0 - 0.35,
    z1 = STREAM_Z1 + 0.35;
  const steps = Math.ceil((z1 - z0) / 0.12);
  for (let i = 0; i <= steps; i++) {
    const z = z0 + ((z1 - z0) * i) / steps;
    const x = streamX(z);
    const ahead = new Vector3(streamX(z + 0.05) - x, 0, 0.05).normalize();
    const side = new Vector3(-ahead.z, 0, ahead.x);
    const level = streamLevel(z) + 0.005;
    const drop =
      Math.max(0, streamLevel(z - 0.15) - streamLevel(z + 0.15)) / 0.3;
    rows.push({
      at: new Vector3(x, level, z),
      side,
      width: STREAM.width + 0.42,
      fall: Math.min(1, drop * 2.2),
    });
  }
  streamRibbon = ribbon(rows, 8);
  return streamRibbon;
}

let curtainRibbon: BufferGeometry | null = null;
let springRibbon: BufferGeometry | null = null;
// 폭포 물줄기: 바위 턱에서 수평으로 나와 포물선으로 소에 떨어진다. 가운데가 살짝 앞으로 부푼다.
function curtainGeometry() {
  if (curtainRibbon) return curtainRibbon;
  const rows: { at: Vector3; side: Vector3; width: number; fall: number }[] =
    [];
  const top = FALL_LIP.y,
    bottom = PLUNGE.level - 0.02;
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const y = top - (top - bottom) * k;
    const z = FALL_LIP.z + 0.05 + Math.sqrt(k) * 0.48;
    rows.push({
      at: new Vector3(FALL_LIP.x, y, z),
      side: new Vector3(1, 0, 0),
      width: 0.78 + 0.32 * k,
      fall: 1,
    });
  }
  curtainRibbon = ribbon(rows, 10);
  // 가운데를 앞으로 부풀려 평평한 판처럼 보이지 않게 한다
  const p = curtainRibbon.getAttribute("position") as BufferAttribute,
    uv = curtainRibbon.getAttribute("uv") as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i) * 2 - 1;
    p.setZ(i, p.getZ(i) + 0.08 * (1 - u * u));
  }
  curtainRibbon.computeBoundingSphere();
  return curtainRibbon;
}
// 폭포 위 바위 사이로 흘러 턱까지 오는 짧은 물길
function springGeometry() {
  if (springRibbon) return springRibbon;
  const rows: { at: Vector3; side: Vector3; width: number; fall: number }[] =
    [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    rows.push({
      at: new Vector3(
        FALL_LIP.x,
        FALL_LIP.y + 0.06 * (1 - k),
        FALL_LIP.z - 0.95 + 1.0 * k,
      ),
      side: new Vector3(-1, 0, 0),
      width: 0.62 + 0.16 * k,
      fall: k * 0.5,
    });
  }
  springRibbon = ribbon(rows, 6);
  return springRibbon;
}

// 폭포 아래 물보라: 떨어지는 자리에서 피어올라 퍼지며 사라지는 점들
const mistVertex = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute float aSeed;
varying float vLife;
void main() {
  float life = fract(uTime * 0.45 + aSeed);
  float a = aSeed * 37.0;
  vec3 p = position + vec3(sin(a) * (0.15 + life * 0.55), life * 0.95, cos(a) * (0.1 + life * 0.45));
  vLife = life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.55 + life * 0.9) * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const mistFragment = /* glsl */ `
uniform vec3 uColor;
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * (1.0 - vLife) * smoothstep(0.0, 0.15, vLife) * 0.55;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;
let mist: { g: BufferGeometry; m: ShaderMaterial } | null = null;
function mistParts() {
  if (mist) return mist;
  const n = 44;
  const g = new BufferGeometry();
  const pos = new Float32Array(n * 3);
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute(
    "aSeed",
    new Float32BufferAttribute(
      Array.from({ length: n }, (_, i) => (i * 0.618034) % 1),
      1,
    ),
  );
  const m = new ShaderMaterial({
    uniforms: {
      uTime: waterTime,
      uScale: { value: 70 * Math.min(globalThis.devicePixelRatio || 1, 2) },
      uColor: { value: new Color(material.seaFoam) },
    },
    vertexShader: mistVertex,
    fragmentShader: mistFragment,
    transparent: true,
    depthWrite: false,
  });
  mist = { g, m };
  return mist;
}

// 연못과 소의 수면. 수면 메시는 물가선보다 조금 넓고, 땅이 덮는 부분은 그려지지 않는다.
export function PondWater() {
  pondDisc ??= disc(POND.radius + 0.35, 160, 18);
  poolDisc ??= disc(PLUNGE.radius + 0.32, 48, 6);
  return (
    <group>
      <mesh
        geometry={pondDisc}
        material={pondShader()}
        position={[POND.x, POND_LEVEL, POND.z]}
        renderOrder={1}
      />
      <mesh
        geometry={poolDisc}
        material={poolShader()}
        position={[PLUNGE.x, PLUNGE.level, PLUNGE.z]}
        renderOrder={1}
      />
      <mesh
        geometry={streamGeometry()}
        material={flowShader(false)}
        renderOrder={2}
      />
    </group>
  );
}

// 폭포 물줄기·위쪽 물길·물보라. 동작 줄이기에서는 물보라를 그리지 않는다.
export function WaterfallWater({ reduced }: { reduced: boolean }) {
  const parts = mistParts();
  return (
    <group>
      <mesh
        geometry={springGeometry()}
        material={flowShader(false)}
        renderOrder={2}
      />
      <mesh
        geometry={curtainGeometry()}
        material={flowShader(true)}
        renderOrder={3}
      />
      {!reduced && (
        <points
          geometry={parts.g}
          material={parts.m}
          position={[FALL_LIP.x, PLUNGE.level + 0.05, FALL_LIP.z + 0.6]}
          frustumCulled={false}
          renderOrder={4}
        />
      )}
    </group>
  );
}

// 물 시간은 FocusIsland가 프레임마다 한 번 갱신한다. 동작 줄이기에서는 거품이 보이는 순간에 멈춘다.
export function useWaterClock(reduced: boolean) {
  useFrame(({ clock }) => {
    waterTime.value = reduced ? 3.3 : clock.elapsedTime;
  });
}
