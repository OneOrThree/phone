import { memo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import {
  DoubleSide,
  Group,
  MeshBasicMaterial,
  type MeshStandardMaterial,
} from "three";
import { Label } from "./Label";
import { BUILDINGS } from "./layout";
import { Forest, Meadow, Seagulls, Terrain, WaterRocks } from "./Scenery";
import {
  hallParts,
  lighthouseParts,
  mailboxParts,
  shopParts,
  type BuildingParts,
} from "./assets3d/buildings";
import { Campfire } from "./assets3d/Campfire";
import { ownSolid, wind } from "./assets3d/materials";
import { Dock } from "./assets3d/Harbor";
import { OceanSurface } from "./assets3d/ocean";
import { GROUND_Y } from "./assets3d/palette";
import { dogBody, dogHead, dogTail } from "./assets3d/props";
import { LIGHTHOUSE_YAW, MAILBOX_YAW } from "./assets3d/site";

// 가리면 옅어지는 건물. CameraOcclusion이 재질 불투명도를 바꾸므로 건물마다 재질을 따로 만든다.
// 섬을 오갈 때마다 새로 만들지 않도록 건물 geometry별로 한 번만 만든다.
const materialCache = new WeakMap<
  BuildingParts,
  {
    solid: MeshStandardMaterial;
    glow: MeshBasicMaterial;
    cloth: MeshStandardMaterial;
  }
>();
function buildingMaterials(parts: BuildingParts) {
  let m = materialCache.get(parts);
  if (!m)
    materialCache.set(
      parts,
      (m = {
        solid: ownSolid(),
        glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
        cloth: ownSolid({ side: DoubleSide, roughness: 0.95 }),
      }),
    );
  return m;
}
function Building({
  parts,
  x,
  z,
  yaw = 0,
  children,
}: {
  parts: BuildingParts;
  x: number;
  z: number;
  yaw?: number;
  children?: (solid: MeshStandardMaterial) => ReactNode;
}) {
  const materials = buildingMaterials(parts);
  return (
    <group
      position={[x, GROUND_Y, z]}
      rotation={[0, yaw, 0]}
      userData={{ fadeWhenBlocking: true }}
    >
      <mesh
        geometry={parts.solid}
        material={materials.solid}
        castShadow
        receiveShadow
      />
      {parts.glow && <mesh geometry={parts.glow} material={materials.glow} />}
      {parts.cloth && (
        <mesh geometry={parts.cloth} material={materials.cloth} castShadow />
      )}
      {children?.(materials.solid)}
    </group>
  );
}

// 상점 계산대 뒤 강아지. 고개를 갸웃하고 꼬리를 흔든다.
function ShopDog({
  material,
  reduced,
}: {
  material: MeshStandardMaterial;
  reduced: boolean;
}) {
  const head = useRef<Group>(null),
    tail = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = reduced ? 0 : clock.elapsedTime;
    if (head.current) {
      head.current.rotation.z = Math.sin(t * 0.9) * 0.14;
      head.current.rotation.x = Math.sin(t * 1.7) * 0.05;
    }
    if (tail.current) tail.current.rotation.z = 0.5 + Math.sin(t * 7) * 0.35;
  });
  return (
    <group position={[0.35, 0.62, 0.32]} rotation={[0, 0.15, 0]}>
      <mesh geometry={dogBody()} material={material} castShadow />
      <group ref={head} position={[0, 0.88, 0.05]}>
        <mesh geometry={dogHead()} material={material} castShadow />
      </group>
      <group ref={tail} position={[0, 0.2, -0.3]} rotation={[-0.6, 0, 0.5]}>
        <mesh geometry={dogTail()} material={material} />
      </group>
    </group>
  );
}

// 일반 섬(우리 섬). 모닥불은 휴식·주민 만남 장소이고, 낚시 집중 의자는 낚시섬에만 있다.
// geometry·공유 재질은 모듈에서 한 번 만들어 두 섬을 오가도 다시 쓰므로 dispose={null}로
// 언마운트 정리 대상에서 뺀다(R3F는 props로 받은 geometry를 지우지 않지만 명시해 둔다).
export const Island = memo(function Island({ reduced }: { reduced: boolean }) {
  // 풀·꽃·나무 흔들림은 셰이더가 처리하고 여기서는 시간 하나만 넘긴다.
  useFrame(({ clock }) => {
    wind.value = reduced ? 2.2 : clock.elapsedTime;
  });
  return (
    <group dispose={null}>
      <Terrain />
      <Meadow />
      <Forest island="home" />
      <WaterRocks />
      <Building parts={hallParts()} x={BUILDINGS.hall.x} z={BUILDINGS.hall.z}>
        {() => <Label position={[0, 0.55, 2.75]} text="마을회관" place />}
      </Building>
      <Building parts={shopParts()} x={BUILDINGS.shop.x} z={BUILDINGS.shop.z}>
        {(solid) => (
          <>
            <ShopDog material={solid} reduced={reduced} />
            <Label position={[0, 0.55, 2.65]} text="강아지 상점" place />
          </>
        )}
      </Building>
      <Building
        parts={lighthouseParts()}
        x={BUILDINGS.lighthouse.x}
        z={BUILDINGS.lighthouse.z}
        yaw={LIGHTHOUSE_YAW}
      />
      <Building
        parts={mailboxParts()}
        x={BUILDINGS.mailbox.x}
        z={BUILDINGS.mailbox.z}
        yaw={MAILBOX_YAW}
      />
      <Campfire reduced={reduced} />
      <Dock reduced={reduced} label="뗏목 부두" />
      <Seagulls reduced={reduced} />
    </group>
  );
});

export function Ocean({ reduced }: { reduced: boolean }) {
  return <OceanSurface reduced={reduced} />;
}
