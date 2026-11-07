import {
  DoubleSide,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
} from "three";

// 바람 시간. Island의 useFrame 하나가 갱신하고 모든 풀·꽃·나무 재질이 공유한다.
// 동작 줄이기에서는 고정 값으로 멈춘다.
export const wind = { value: 0 };

type Sway = { base: number; amount: number; speed: number; key: string };
export const SWAY = {
  grass: { base: 0, amount: 0.22, speed: 1.6, key: "grass" },
  flower: { base: 0.05, amount: 0.16, speed: 1.3, key: "flower" },
  bush: { base: 0.2, amount: 0.035, speed: 0.9, key: "bush" },
  tree: { base: 1.1, amount: 0.028, speed: 0.75, key: "tree" },
  reed: { base: 0.12, amount: 0.07, speed: 1.15, key: "reed" },
  seaweed: { base: 0, amount: 0.5, speed: 0.9, key: "seaweed" },
} satisfies Record<string, Sway>;

// 정점 셰이더에서 높이에 비례해 흔든다. CPU 갱신 없이 수천 개를 움직인다.
export function swayMaterial(
  sway: Sway,
  params: MeshStandardMaterialParameters = {},
) {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    ...params,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 swayAnchor = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
#else
  vec2 swayAnchor = vec2(modelMatrix[3].x, modelMatrix[3].z);
#endif
  float swayH = max(0.0, position.y - ${sway.base.toFixed(3)});
  float swayP = uWind * ${sway.speed.toFixed(3)} + swayAnchor.x * 0.31 + swayAnchor.y * 0.23;
  float swayK = swayH * swayH * ${sway.amount.toFixed(4)};
  transformed.x += (sin(swayP) + 0.35 * sin(swayP * 2.3 + 1.7)) * swayK;
  transformed.z += cos(swayP * 0.83 + 1.1) * swayK * 0.6;`,
      );
  };
  m.customProgramCacheKey = () => `sway-${sway.key}`;
  return m;
}

export const grassMaterial = swayMaterial(SWAY.grass, {
  side: DoubleSide,
  roughness: 1,
});
export const flowerMaterial = swayMaterial(SWAY.flower, { roughness: 0.85 });
// 꽃잎은 인스턴스 색을 쓰므로 줄기와 재질을 나눠 셰이더 전환을 피한다.
export const petalMaterial = swayMaterial(SWAY.flower, { roughness: 0.8 });
export const bushMaterial = swayMaterial(SWAY.bush, { roughness: 0.95 });
// 낚시섬: 물가 갈대와 물속 수초
export const reedMaterial = swayMaterial(SWAY.reed, {
  side: DoubleSide,
  roughness: 0.9,
});
export const seaweedMaterial = swayMaterial(SWAY.seaweed, {
  side: DoubleSide,
  roughness: 1,
});
export const solidMaterial = new MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.88,
  metalness: 0,
});
// 인스턴싱 메시 전용(같은 재질을 일반·인스턴싱 메시가 함께 쓰면 매 프레임 셰이더가 바뀐다)
export const instancedSolid = new MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  metalness: 0,
});
// 가리면 옅게 하는 건물·나무는 재질을 공유하면 함께 옅어지므로 각자 만든다.
export const ownSolid = (params: MeshStandardMaterialParameters = {}) =>
  new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
    ...params,
  });
