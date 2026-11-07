import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  PointLight,
  ShaderMaterial,
} from "three";
import { CAMPFIRE } from "../layout";
import { Label } from "../Label";
import { solidMaterial } from "./materials";
import { GROUND_Y, material } from "./palette";
import { campfireBase, flameGeometry } from "./props";

const flameVertex = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying float vH;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 p = position;
  float h = p.y;
  p.x += (sin(uTime * 6.1 + uSeed + h * 3.0) * 0.09 + sin(uTime * 9.7 + uSeed * 2.0) * 0.04) * h;
  p.z += cos(uTime * 5.3 + uSeed + h * 2.5) * 0.07 * h;
  p.xz *= 1.0 + sin(uTime * 11.0 + uSeed + h * 6.0) * 0.07 * h;
  p.y *= 1.0 + sin(uTime * 7.3 + uSeed) * 0.07;
  vH = h;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const flameFragment = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
uniform float uAlpha;
varying float vH;
varying vec3 vN;
varying vec3 vView;
void main() {
  float rim = 1.0 - abs(dot(vN, normalize(vView)));
  vec3 c = mix(uCore, uMid, smoothstep(0.05, 0.6, rim + vH * 0.45));
  c = mix(c, uEdge, smoothstep(0.5, 1.05, rim * 0.6 + vH * 0.75));
  float a = (1.0 - smoothstep(0.7, 1.0, vH)) * (1.0 - rim * 0.45) * uAlpha;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`;
const emberVertex = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute float aSeed;
varying float vLife;
void main() {
  float life = fract(uTime * 0.32 + aSeed);
  vec3 p = vec3(sin(aSeed * 91.0) * 0.4, 0.55 + life * 2.8, cos(aSeed * 53.0) * 0.4);
  p.x += sin(uTime * 2.0 + aSeed * 20.0) * 0.22 * life;
  p.z += cos(uTime * 1.7 + aSeed * 13.0) * 0.22 * life;
  vLife = life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (1.0 - life * 0.6) * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const emberFragment = /* glsl */ `
uniform vec3 uWarm;
uniform vec3 uLight;
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * smoothstep(0.0, 0.12, vLife);
  gl_FragColor = vec4(mix(uWarm, uLight, 1.0 - vLife), a);
  #include <colorspace_fragment>
}
`;

const FLAMES: {
  at: [number, number, number];
  s: [number, number, number];
  tone: number;
  alpha: number;
}[] = [
  { at: [0, 0.18, 0], s: [1.15, 1.75, 1.15], tone: 0, alpha: 0.82 },
  { at: [0.28, 0.16, 0.12], s: [0.55, 1.05, 0.55], tone: 0, alpha: 0.8 },
  { at: [-0.26, 0.16, -0.1], s: [0.6, 1.15, 0.6], tone: 0, alpha: 0.8 },
  { at: [0.02, 0.2, 0.02], s: [0.72, 1.25, 0.72], tone: 1, alpha: 0.92 },
  { at: [0, 0.22, 0.05], s: [0.36, 0.72, 0.36], tone: 2, alpha: 1 },
];

// 큰 모닥불: 돌 고리·장작·일렁이는 불꽃·떠오르는 불티·흔들리는 불빛.
export function Campfire({ reduced }: { reduced: boolean }) {
  const light = useRef<PointLight>(null);
  const flames = useMemo(
    () =>
      FLAMES.map(({ tone, alpha }, i) => {
        const tones = [
          [material.fireMid, material.fireEdge, "#F0663A"],
          [material.fireCore, material.fireMid, material.fireEdge],
          ["#FFFDF0", material.fireCore, material.fireMid],
        ][tone];
        return new ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uSeed: { value: i * 1.93 },
            uCore: { value: new Color(tones[0]) },
            uMid: { value: new Color(tones[1]) },
            uEdge: { value: new Color(tones[2]) },
            uAlpha: { value: alpha },
          },
          vertexShader: flameVertex,
          fragmentShader: flameFragment,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        });
      }),
    [],
  );
  const embers = useMemo(() => {
    const g = new BufferGeometry();
    const n = 34;
    g.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array(n * 3), 3),
    );
    g.setAttribute(
      "aSeed",
      new Float32BufferAttribute(
        Array.from({ length: n }, (_, i) => (i * 0.618034) % 1),
        1,
      ),
    );
    g.boundingSphere = null;
    const m = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 90 * Math.min(window.devicePixelRatio || 1, 2) },
        uWarm: { value: new Color(material.fireEdge) },
        uLight: { value: new Color(material.fireCore) },
      },
      vertexShader: emberVertex,
      fragmentShader: emberFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    return { g, m };
  }, []);
  useFrame(({ clock }) => {
    const t = reduced ? 1.3 : clock.elapsedTime;
    for (const f of flames) f.uniforms.uTime.value = t;
    embers.m.uniforms.uTime.value = t;
    if (light.current)
      light.current.intensity = reduced
        ? 7
        : 7 + Math.sin(t * 7.3) * 0.7 + Math.sin(t * 13.1) * 0.45;
  });
  return (
    <group position={[CAMPFIRE.x, GROUND_Y, CAMPFIRE.z]}>
      <mesh
        geometry={campfireBase()}
        material={solidMaterial}
        castShadow
        receiveShadow
      />
      {FLAMES.map(({ at, s }, i) => (
        <mesh
          key={i}
          geometry={flameGeometry()}
          material={flames[i]}
          position={at}
          scale={s}
          renderOrder={2 + i}
        />
      ))}
      {!reduced && (
        <points
          geometry={embers.g}
          material={embers.m}
          frustumCulled={false}
          renderOrder={8}
        />
      )}
      <pointLight
        ref={light}
        position={[0, 1.1, 0]}
        color={material.fireMid}
        intensity={7}
        distance={12}
        decay={1.4}
      />
      <Label position={[0, 2.6, 0]} text="모닥불" place />
    </group>
  );
}
