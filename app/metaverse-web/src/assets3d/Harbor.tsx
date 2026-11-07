import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, MeshBasicMaterial } from "three";
import { Label } from "../Label";
import { solidMaterial } from "./materials";
import { GROUND_Y, SEA_LEVEL } from "./palette";
import { boatGeometry, dockParts, mooringRope } from "./props";
import { BOAT, DOCK } from "./site";

const glowMaterial = new MeshBasicMaterial({
  vertexColors: true,
  toneMapped: false,
});

// 뗏목 부두와 매어 둔 나룻배. 두 섬이 같은 자리·같은 geometry를 써서
// 바다 셰이더의 기둥·배 포말(FOAM_SOURCES)이 어느 섬에서도 맞는다.
export function Dock({ reduced, label }: { reduced: boolean; label: string }) {
  const boat = useRef<Group>(null);
  const parts = dockParts();
  useFrame(({ clock }) => {
    if (!boat.current) return;
    const t = reduced ? 0 : clock.elapsedTime;
    boat.current.position.y = SEA_LEVEL + 0.02 + Math.sin(t * 1.1) * 0.035;
    boat.current.rotation.z = Math.sin(t * 0.9 + 0.5) * 0.035;
    boat.current.rotation.x = Math.sin(t * 0.7) * 0.02;
  });
  return (
    <group>
      <mesh
        geometry={parts.solid}
        material={solidMaterial}
        castShadow
        receiveShadow
      />
      <mesh geometry={parts.glow} material={glowMaterial} />
      <group
        ref={boat}
        position={[BOAT.x, SEA_LEVEL + 0.02, BOAT.z]}
        rotation={[0, BOAT.yaw, 0]}
      >
        <mesh
          geometry={boatGeometry()}
          material={solidMaterial}
          castShadow
          receiveShadow
        />
      </group>
      <mesh geometry={mooringRope()} material={solidMaterial} />
      <Label
        position={[0, GROUND_Y + 0.55, (DOCK.z0 + DOCK.z1) / 2 + 0.4]}
        text={label}
        place
      />
    </group>
  );
}
