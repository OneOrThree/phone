import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
} from "three";
import { Label } from "./Label";
import { art } from "./theme";
import type { Actor } from "./world";
import { catGeometry, createCatRig } from "./assets3d/catModel";
import { placeFloat, poseBones, POSES } from "./assets3d/catPose";
import { GROUND_Y } from "./assets3d/palette";
import { blobShadowTexture } from "./assets3d/textures";

const blobGeometry = new PlaneGeometry(1.15, 1).rotateX(-Math.PI / 2);
let blobMaterial: MeshBasicMaterial | null = null;
const blob = () =>
  (blobMaterial ??= new MeshBasicMaterial({
    color: "#4a3a30",
    alphaMap: blobShadowTexture(),
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  }));
const ringGeometry = new RingGeometry(0.5, 0.57, 48).rotateX(-Math.PI / 2);
const ringMaterial = new MeshBasicMaterial({
  color: art.paper,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  toneMapped: false,
});

export function Cat({
  actor,
  local = false,
  label,
  reduced = false,
}: {
  actor: Actor;
  local?: boolean;
  label?: string;
  reduced?: boolean;
}) {
  const root = useRef<Group>(null),
    anchor = useRef<Group>(null),
    shadow = useRef<Mesh>(null);
  // 털색이 바뀌어도 뼈대는 유지하고 geometry만 바꾼다(프레임 안에서 처리).
  const rig = useMemo(() => createCatRig(actor.color, local), [local]);
  useEffect(() => () => rig.mesh.skeleton.dispose(), [rig]);
  const seed = useMemo(() => Math.random() * 60, []);
  const motion = useRef({
    phase: 0,
    walk: 0,
    sit: 0,
    wave: 0,
    fish: 0,
    focus: 0,
    x: actor.x,
    z: actor.z,
    color: actor.color as string,
  });
  // 원격 고양이의 보간 위치가 React 갱신으로 덮이지 않도록 시작 위치만 prop으로 준다.
  const [initialPosition] = useState<[number, number, number]>(() => [
    actor.x,
    GROUND_Y,
    actor.z,
  ]);
  const [initialYaw] = useState(() => actor.yaw);

  useFrame(({ clock }, delta) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(delta, 0.1),
      m = motion.current,
      live = reduced ? 0 : 1,
      t = clock.elapsedTime + seed;
    if (actor.color !== m.color) {
      m.color = actor.color;
      rig.mesh.geometry = catGeometry(actor.color, local);
    }
    const follow = local ? 1 : 1 - Math.exp(-14 * dt);
    g.position.x += (actor.x - g.position.x) * follow;
    g.position.z += (actor.z - g.position.z) * follow;
    const travelled = Math.hypot(g.position.x - m.x, g.position.z - m.z);
    m.x = g.position.x;
    m.z = g.position.z;
    // 실제 이동 거리로 걸음 위상을 진행해 제자리 발 구르기를 막는다.
    if (travelled < 1) m.phase += travelled * 8.5;
    const blend = reduced ? 1 : 1 - Math.exp(-10 * dt);
    const action = actor.action as string;
    for (const key of POSES)
      m[key] += ((action === key ? 1 : 0) - m[key]) * blend;
    const turn = Math.atan2(
      Math.sin(actor.yaw - g.rotation.y),
      Math.cos(actor.yaw - g.rotation.y),
    );
    g.rotation.y += turn * (reduced ? 1 : 1 - Math.exp(-14 * dt));

    const lift = poseBones(rig.bones, m, t, live, seed);
    placeFloat(rig.bones, m, t, live);

    if (anchor.current) anchor.current.position.y = 2.05 + 0.27 * m.focus;
    if (shadow.current)
      shadow.current.scale.setScalar(1 - 0.25 * m.focus + 0.05 * lift);
  });

  return (
    <group ref={root} position={initialPosition} rotation={[0, initialYaw, 0]}>
      <primitive object={rig.mesh} />
      <mesh
        ref={shadow}
        geometry={blobGeometry}
        material={blob()}
        position={[0, 0.012, 0.02]}
        renderOrder={-1}
      />
      {local && (
        <mesh
          geometry={ringGeometry}
          material={ringMaterial}
          position={[0, 0.016, 0]}
        />
      )}
      <group ref={anchor} position={[0, 2.05, 0]}>
        <Label position={[0, 0, 0]} text={label || actor.name} self={local} />
      </group>
    </group>
  );
}
