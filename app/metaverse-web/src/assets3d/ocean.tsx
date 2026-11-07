import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { material, SEA_LEVEL } from "./palette";
import { shoreGLSL } from "./shoreline";
import { FOAM_SOURCES } from "./site";

// 바다 수면. 섬 아래(반경 12)부터 안개 너머(반경 420)까지 이어지는 극좌표 메시로,
// 물가 근처만 촘촘해 파도 높이로 물가선이 모래 위를 오르내린다.
let cached: BufferGeometry | null = null;
function oceanGeometry() {
  if (cached) return cached;
  const radii: number[] = [];
  for (let r = 12; r < 34; r += 0.3) radii.push(r);
  let r = 34,
    step = 0.6;
  while (r < 420) {
    radii.push(r);
    r += step;
    step *= 1.09;
  }
  radii.push(420);
  const segments = 320;
  const pos = new Float32Array(radii.length * (segments + 1) * 3);
  let v = 0;
  for (const radius of radii)
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.set([Math.cos(a) * radius, 0, Math.sin(a) * radius], v * 3);
      v++;
    }
  const index: number[] = [];
  for (let i = 0; i < radii.length - 1; i++)
    for (let s = 0; s < segments; s++) {
      const a = i * (segments + 1) + s,
        b = a + 1,
        c = a + segments + 1,
        d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(new Uint32Array(index), 1));
  g.computeBoundingSphere();
  cached = g;
  return g;
}

const SUN = new Vector3(-18, 34, 20).normalize();
const COUNT = FOAM_SOURCES.length;

const vertexShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vShore;
#include <fog_pars_vertex>
${shoreGLSL}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 info = shoreInfo(world.xz);
  float d = info.x;
  float far = smoothstep(0.0, 14.0, d);
  float swell = sin(dot(world.xz, vec2(0.23, 0.11)) - uTime * 0.85) * 0.6
    + sin(dot(world.xz, vec2(-0.09, 0.27)) - uTime * 0.63 + 1.7) * 0.4;
  // 물가가 천천히 밀려왔다 빠지도록 물가 근처 수면 전체를 오르내린다.
  float surge = sin(uTime * 0.52 + info.z * 2.0) * (1.0 - smoothstep(0.0, 5.0, d));
  world.y += swell * mix(0.02, 0.07, far) + surge * 0.04;
  vWorld = world.xyz;
  vShore = info;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uSun;
uniform vec3 uFoamSources[${COUNT}];
varying vec3 vWorld;
varying vec3 vShore;
#include <fog_pars_fragment>
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
// 옥타브마다 좌표를 돌려 격자 무늬가 드러나지 않게 한다.
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = r * p * 2.03 + 7.1;
    a *= 0.5;
  }
  return v;
}
vec2 waveSlope(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d1 = vec2(0.8, 0.6), d2 = vec2(-0.6, 0.8), d3 = vec2(0.28, -0.96), d4 = vec2(-0.92, -0.39);
  g += d1 * cos(dot(d1, p) * 0.9 - t * 0.9) * 0.05;
  g += d2 * cos(dot(d2, p) * 1.45 - t * 1.15 + 1.3) * 0.045;
  g += d3 * cos(dot(d3, p) * 2.3 - t * 1.6 + 2.1) * 0.035;
  g += d4 * cos(dot(d4, p) * 3.4 - t * 2.1 + 0.4) * 0.025;
  return g;
}
void main() {
  vec2 p = vWorld.xz;
  float d = vShore.x;
  float depth = vShore.y;
  float t = uTime;
  float dist = length(cameraPosition - vWorld);
  // 멀수록 잔물결을 줄여 화면에 점 무늬가 끓지 않게 한다.
  float near = 1.0 - smoothstep(18.0, 70.0, dist);
  float tint = fbm(p * 0.16 + vec2(t * 0.03, -t * 0.02));
  // 큰 노이즈로 파도 세기를 지역마다 바꿔 같은 방향 줄무늬가 반복되지 않게 한다.
  vec2 g = waveSlope(p, t) * (0.45 + 1.1 * tint);
  g += (vec2(noise(p * 4.1 + t * 0.35), noise(p * 4.3 - t * 0.31)) - 0.5) * 0.09 * near;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorld);

  vec3 col = mix(uShallow, uMid, smoothstep(0.05, 1.4, depth));
  col = mix(col, uDeep, clamp(smoothstep(1.4, 2.8, depth) * 0.55 + smoothstep(10.0, 80.0, d) * 0.45, 0.0, 1.0));
  col *= 0.95 + 0.1 * tint;
  // 얕은 곳의 물빛 무늬
  float caustic = smoothstep(0.55, 0.8, fbm(p * 0.9 + vec2(t * 0.12, t * 0.07))) * (1.0 - smoothstep(0.2, 1.6, depth));
  col += uFoam * caustic * 0.12;
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
  col = mix(col, uSky, fres * 0.4);
  vec3 h = normalize(uSun + v);
  float spec = pow(max(dot(n, h), 0.0), 240.0);
  // 반짝임: 천천히 움직이는 성긴 점. 깜빡임이 강하지 않게 밝기를 제한한다.
  float sp = noise(p * 2.1 + vec2(t * 0.27, t * 0.14)) * noise(p * 3.3 - vec2(t * 0.19, -t * 0.24));
  float glint = smoothstep(0.56, 0.74, sp) * 0.18 * smoothstep(0.5, 3.0, d) * near;

  // 물가 포말: 물가선의 젖은 띠 + 바다에서 밀려와 물가에서 사라지는 물결 띠
  float surge = sin(t * 0.52 + vShore.z * 2.0);
  float edgeNoise = noise(p * 1.7 + t * 0.15);
  float edgeWidth = 0.22 + 0.26 * (0.5 + 0.5 * surge);
  float edge = (1.0 - smoothstep(0.0, edgeWidth, d + 0.04)) * (0.6 + 0.4 * edgeNoise);
  float phase = d * 0.45 + t * 0.3 + fbm(p * 0.33) * 0.9;
  float band = fract(phase);
  float line = 1.0 - smoothstep(0.0, 0.07, abs(band - 0.88));
  float reach = 1.0 - smoothstep(0.8, 4.4, d);
  float breakup = smoothstep(0.3, 0.68, noise(p * 0.85 + vec2(t * 0.08, -t * 0.05)));
  float bands = line * reach * mix(0.25, 1.0, breakup) * smoothstep(0.05, 0.7, d);
  float lace = smoothstep(0.64, 0.8, noise(p * 3.6 + vec2(t * 0.22, t * 0.1))) * reach * 0.3 * (0.4 + 0.6 * (0.5 + 0.5 * surge));
  float rocks = 0.0;
  if (d < 10.0) {
    float rn = noise(p * 4.2 + t * 0.2);
    for (int i = 0; i < ${COUNT}; i++) {
      vec3 r = uFoamSources[i];
      float dd = length(p - r.xy) - r.z;
      float pulse = 0.5 + 0.5 * sin(t * 1.15 + float(i) * 1.7);
      float w = 0.14 + 0.24 * pulse;
      rocks += (1.0 - smoothstep(0.0, w, dd)) * smoothstep(-0.3, 0.0, dd) * (0.5 + 0.5 * rn);
    }
  }
  float foam = clamp(max(edge, bands) + lace + rocks * 0.8, 0.0, 1.0);
  col = mix(col, uFoam, foam * 0.92);
  col += uFoam * (spec * mix(0.18, 0.5, near) + glint);
  float alpha = mix(0.42, 0.97, smoothstep(0.0, 1.3, depth));
  alpha = max(alpha, foam * 0.95);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function OceanSurface({ reduced }: { reduced: boolean }) {
  const shader = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uTime: { value: 0 },
            uDeep: { value: new Color(material.seaDeep) },
            uMid: { value: new Color(material.seaMid) },
            uShallow: { value: new Color(material.seaShallow) },
            uFoam: { value: new Color(material.seaFoam) },
            uSky: { value: new Color(material.seaSky) },
            uSun: { value: SUN.clone() },
            uFoamSources: {
              value: FOAM_SOURCES.map(([x, z, r]) => new Vector3(x, z, r)),
            },
          },
        ]),
        vertexShader,
        fragmentShader,
        fog: true,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  // 동작 줄이기에서는 포말 띠가 보이는 순간으로 시간을 고정한다.
  useFrame(({ clock }) => {
    shader.uniforms.uTime.value = reduced ? 6.4 : clock.elapsedTime;
  });
  return (
    <mesh
      geometry={oceanGeometry()}
      material={shader}
      position={[0, SEA_LEVEL, 0]}
      renderOrder={-2}
      frustumCulled={false}
    />
  );
}
