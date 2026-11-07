import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import {
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  chairCushionGeometry,
  chairFrameGeometry,
  chairHitGeometry,
  seatRingGeometry,
} from "./assets3d/chair";
import { GROUND_Y, material } from "./assets3d/palette";
import { Label } from "./Label";
import { FOCUS_SEATS, SEAT_SECTIONS } from "./layout";
import { art } from "./theme";

const frameMaterial = new MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.78,
});
const cushionMaterial = new MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.95,
});
const hitMaterial = new MeshBasicMaterial({ visible: false });
const ringMaterial = (color: string, opacity: number) =>
  new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
const hoverMaterial = ringMaterial(art.paper, 0.9);
const mineMaterial = ringMaterial(art.pink, 0.95);
const mineGlowMaterial = ringMaterial(art.pink, 0.22);
const pendingMaterial = ringMaterial(art.butter, 0.95);
// 대기 중 좌석은 움직임 없이 끊어진 고리로 구분한다(동작 줄이기와 무관하게 정지).
let dashed: BufferGeometry | null = null;
function dashedRing() {
  if (dashed) return dashed;
  const parts = Array.from({ length: 12 }, (_, i) =>
    new RingGeometry(
      0.62,
      0.78,
      6,
      1,
      (i / 12) * Math.PI * 2,
      (Math.PI * 2) / 24,
    )
      .toNonIndexed()
      .rotateX(-Math.PI / 2),
  );
  dashed = mergeGeometries(parts);
  return dashed;
}
let glowDisc: RingGeometry | null = null;
const glowGeometry = () =>
  (glowDisc ??= new RingGeometry(0.1, 0.6, 40).rotateX(-Math.PI / 2));

const tones = {
  free: new Color(material.cushion),
  hover: new Color(material.cushionHover),
  mine: new Color(material.cushionMine),
  pending: new Color(material.cushionPending),
  taken: new Color(material.cushionTaken),
};

export function FocusSeats({
  occupied,
  activeSeatId,
  pendingSeatId,
  onSelect,
}: {
  occupied: ReadonlyMap<number, string>;
  activeSeatId: number | null;
  pendingSeatId: number | null;
  onSelect: (seatId: number) => void;
}) {
  const frame = useRef<InstancedMesh>(null),
    cushion = useRef<InstancedMesh>(null),
    hit = useRef<InstancedMesh>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const gl = useThree((state) => state.gl);
  const seats = FOCUS_SEATS;
  const byId = useMemo(
    () => new Map(seats.map((seat) => [seat.id, seat])),
    [seats],
  );
  const blocked = (id: number) => occupied.has(id) && id !== activeSeatId;

  useLayoutEffect(() => {
    const o = new Object3D();
    seats.forEach((seat, i) => {
      o.position.set(seat.x, GROUND_Y, seat.z);
      o.rotation.set(0, seat.yaw, 0);
      o.updateMatrix();
      for (const mesh of [frame.current, cushion.current, hit.current])
        mesh?.setMatrixAt(i, o.matrix);
    });
    for (const mesh of [frame.current, cushion.current, hit.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
    }
  }, [seats]);

  useLayoutEffect(() => {
    const mesh = cushion.current;
    if (!mesh) return;
    const c = new Color();
    seats.forEach((seat, i) => {
      const id = seat.id;
      c.copy(
        id === activeSeatId
          ? tones.mine
          : id === pendingSeatId
            ? tones.pending
            : occupied.has(id)
              ? tones.taken
              : tones.free,
      );
      if (hovered === id && !blocked(id)) c.lerp(tones.hover, 0.55);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  useEffect(() => {
    const canvas = gl.domElement,
      previous = canvas.style.cursor;
    if (hovered !== null)
      canvas.style.cursor = blocked(hovered) ? "not-allowed" : "pointer";
    return () => {
      canvas.style.cursor = previous;
    };
  });

  const seatOf = (event: ThreeEvent<PointerEvent | MouseEvent>) =>
    event.instanceId === undefined
      ? null
      : (seats[event.instanceId]?.id ?? null);
  const hover = (id: number | null) => {
    if (hoveredRef.current === id) return;
    hoveredRef.current = id;
    setHovered(id);
  };

  const hoveredSeat = hovered === null ? undefined : byId.get(hovered);
  const activeSeat = activeSeatId === null ? undefined : byId.get(activeSeatId);
  const pendingSeat =
    pendingSeatId === null || pendingSeatId === activeSeatId
      ? undefined
      : byId.get(pendingSeatId);
  // 이름표: 「동쪽 물가 3번 낚시 의자 · 비어 있음」. 번호는 id + 1.
  const hoverText = (id: number) => {
    const name = occupied.get(id);
    const seat = byId.get(id);
    const place = `${seat ? `${SEAT_SECTIONS[seat.ring]} ` : ""}${id + 1}번 낚시 의자`;
    if (id === activeSeatId) return `${place} · 내 자리`;
    if (id === pendingSeatId) return `${place} · 앉는 중`;
    if (name) return `${place} · ${name} 낚시 중`;
    return `${place} · 비어 있음`;
  };

  return (
    <group>
      <instancedMesh
        ref={frame}
        args={[chairFrameGeometry(), frameMaterial, seats.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={cushion}
        args={[chairCushionGeometry(), cushionMaterial, seats.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={hit}
        args={[chairHitGeometry(), hitMaterial, seats.length]}
        onPointerMove={(event) => hover(seatOf(event))}
        onPointerOut={() => hover(null)}
        onClick={(event) => {
          if (event.delta > 6) return;
          const id = seatOf(event);
          if (id === null) return;
          event.stopPropagation();
          if (blocked(id)) return;
          onSelect(id);
        }}
      />
      {activeSeat && (
        <group position={[activeSeat.x, GROUND_Y + 0.018, activeSeat.z]}>
          <mesh geometry={seatRingGeometry()} material={mineMaterial} />
          <mesh geometry={glowGeometry()} material={mineGlowMaterial} />
        </group>
      )}
      {pendingSeat && (
        <mesh
          position={[pendingSeat.x, GROUND_Y + 0.02, pendingSeat.z]}
          rotation={[0, pendingSeat.yaw, 0]}
          geometry={dashedRing()}
          material={pendingMaterial}
        />
      )}
      {hoveredSeat && (
        <>
          <mesh
            position={[hoveredSeat.x, GROUND_Y + 0.022, hoveredSeat.z]}
            scale={1.08}
            geometry={seatRingGeometry()}
            material={hoverMaterial}
          />
          <Label
            position={[hoveredSeat.x, GROUND_Y + 1.35, hoveredSeat.z]}
            text={hoverText(hoveredSeat.id)}
            place
          />
        </>
      )}
    </group>
  );
}
