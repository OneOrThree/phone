import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Color,
  Group,
  InstancedMesh,
  Object3D,
  type BufferGeometry,
  type Material,
  type MeshStandardMaterial,
} from "three";
import { art } from "./theme";
import { CAMPFIRE, TREE_POSITIONS } from "./layout";
import { fbm, rng } from "./assets3d/geometry";
import {
  bushMaterial,
  flowerMaterial,
  grassMaterial,
  instancedSolid,
  petalMaterial,
  solidMaterial,
  swayMaterial,
  SWAY,
} from "./assets3d/materials";
import {
  broadleaf,
  bush,
  fern,
  flowerPetals,
  flowerStems,
  grassTuft,
  paver,
  pine,
  rock,
  willow,
} from "./assets3d/nature";
import { GROUND_Y, SEA_LEVEL } from "./assets3d/palette";
import { gullBody, gullWing } from "./assets3d/props";
import { polar, shoreDistance } from "./assets3d/shoreline";
import {
  buildingClearance,
  FOOTPRINTS,
  isOpenGround,
  pathDistance,
  PATH_SAMPLES,
  PLAZA_RADIUS,
  STONE_RINGS,
  TREES,
  WATER_ROCKS,
} from "./assets3d/site";
import { terrainGeometry } from "./assets3d/terrain";
import { FOCUS_TREES } from "./assets3d/pond";

// 섬의 자연물: 지형, 풀·꽃·덤불·디딤돌(인스턴싱), 나무, 물가 바위, 갈매기.
export type Placement = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number | [number, number, number];
  tilt?: number;
  color?: string;
};

export function Instances({
  geometry,
  material,
  items,
  shadow = false,
}: {
  geometry: BufferGeometry;
  material: Material;
  items: Placement[];
  shadow?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D(),
      c = new Color();
    items.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(p.tilt ?? 0, p.yaw, 0);
      if (typeof p.s === "number") o.scale.setScalar(p.s);
      else o.scale.set(...p.s);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      if (p.color) mesh.setColorAt(i, c.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={shadow}
      receiveShadow
    />
  );
}

export function Terrain() {
  return (
    <mesh geometry={terrainGeometry()} material={solidMaterial} receiveShadow />
  );
}

const FLOWER_TONES = [
  art.pink,
  art.butter,
  art.paper,
  "#F7B58F",
  art.sky,
  "#CDB8EC",
];

export function Meadow() {
  const data = useMemo(() => {
    const random = rng(2786);
    const grass: Placement[] = [],
      flowers: Placement[] = [],
      bushes: Placement[][] = [[], [], []],
      ferns: Placement[] = [],
      pavers: Placement[] = [],
      pebbles: Placement[] = [];
    // 풀: 흔들린 격자 표본. 노이즈로 빽빽한 곳과 성긴 곳을 나눈다.
    const cell = 0.78;
    for (let x = -23; x <= 23; x += cell)
      for (let z = -21; z <= 21; z += cell) {
        const px = x + (random() - 0.5) * cell,
          pz = z + (random() - 0.5) * cell;
        if (!isOpenGround(px, pz)) continue;
        const density = fbm(px * 0.12 + 40, pz * 0.12 - 3, 2);
        if (random() > 0.35 + density * 0.9) continue;
        // 모래사장에는 드문드문만 남긴다
        if (shoreDistance(px, pz) > -2.2 && random() < 0.85) continue;
        grass.push({
          x: px,
          y: GROUND_Y - 0.01,
          z: pz,
          yaw: random() * 6.28,
          s: [
            0.85 + random() * 0.4,
            0.75 + random() * 0.75,
            0.85 + random() * 0.4,
          ],
          tilt: (random() - 0.5) * 0.2,
        });
      }
    // 꽃 무더기
    let clusters = 0;
    for (let i = 0; i < 500 && clusters < 58; i++) {
      // 광장 바깥(예전 의자 고리 자리)부터 섬 가장자리까지 꽃무더기를 흩는다.
      const a = random() * Math.PI * 2,
        r = PLAZA_RADIUS + 0.9 + random() * 14.3;
      const cx = Math.cos(a) * r,
        cz = Math.sin(a) * r * 0.93;
      if (!isOpenGround(cx, cz, 0.2)) continue;
      clusters++;
      const tone = FLOWER_TONES[clusters % FLOWER_TONES.length];
      const n = 5 + Math.floor(random() * 6);
      for (let k = 0; k < n; k++) {
        const fx = cx + (random() - 0.5) * 1.5,
          fz = cz + (random() - 0.5) * 1.5;
        if (!isOpenGround(fx, fz)) continue;
        flowers.push({
          x: fx,
          y: GROUND_Y - 0.01,
          z: fz,
          yaw: random() * 6.28,
          s: 0.85 + random() * 0.55,
          tilt: (random() - 0.5) * 0.25,
          color: random() < 0.82 ? tone : FLOWER_TONES[(clusters + 2) % 6],
        });
      }
    }
    // 길가 꽃 몇 송이
    for (const path of PATH_SAMPLES)
      path.samples.forEach(([x, z], i) => {
        if (i % 9 !== 4) return;
        const side = i % 2 ? 1 : -1;
        const fx = x + side * (path.width + 0.55),
          fz = z + (random() - 0.5) * 0.4;
        if (!isOpenGround(fx, fz)) return;
        flowers.push({
          x: fx,
          y: GROUND_Y - 0.01,
          z: fz,
          yaw: random() * 6.28,
          s: 0.9 + random() * 0.3,
          color: FLOWER_TONES[i % 6],
        });
      });
    // 나무 아래 덤불·고사리
    TREES.forEach((tree, i) => {
      for (let k = 0; k < 2; k++) {
        const a = random() * Math.PI * 2,
          r = 0.75 + random() * 0.6;
        const x = tree.x + Math.cos(a) * r,
          z = tree.z + Math.sin(a) * r;
        if (buildingClearance(x, z) < 0.5 || pathDistance(x, z) < 0.6) continue;
        if (polar(x, z).rn > 0.985) continue;
        if (k === 0 && i % 2 === 0)
          bushes[(i + k) % 3].push({
            x,
            y: GROUND_Y - 0.02,
            z,
            yaw: random() * 6.28,
            s: 0.7 + random() * 0.45,
          });
        else
          ferns.push({
            x,
            y: GROUND_Y - 0.01,
            z,
            yaw: random() * 6.28,
            s: 0.8 + random() * 0.6,
          });
      }
    });
    // 건물 둘레 덤불(입구 쪽은 비운다)
    for (const f of Object.values(FOOTPRINTS)) {
      if (f.kind === "circle" && f.r < 0.6) continue;
      const reach = f.kind === "box" ? Math.max(f.hx, f.hz) + 0.7 : f.r + 0.65;
      for (let k = 0; k < (f.kind === "box" ? 7 : 4); k++) {
        const a =
          -Math.PI / 2 + (k - 3) * 0.55 + Math.PI + (random() - 0.5) * 0.3;
        const x = f.x + Math.cos(a) * reach,
          z = f.z + Math.sin(a) * reach * 0.9;
        if (buildingClearance(x, z) < 0.25 || pathDistance(x, z) < 0.5)
          continue;
        if (TREE_POSITIONS.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 0.9))
          continue;
        bushes[k % 3].push({
          x,
          y: GROUND_Y - 0.02,
          z,
          yaw: random() * 6.28,
          s: 0.65 + random() * 0.35,
        });
      }
    }
    // 광장의 돌길 고리와 길 위 디딤돌
    for (const ring of STONE_RINGS) {
      const n = Math.round((Math.PI * 2 * ring) / 0.66);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + random() * 0.04;
        const rr = ring + (random() - 0.5) * 0.14;
        pavers.push({
          x: CAMPFIRE.x + Math.cos(a) * rr,
          y: GROUND_Y + 0.005,
          z: CAMPFIRE.z + Math.sin(a) * rr,
          yaw: a + random() * 0.4,
          s: [0.85 + random() * 0.3, 1, 0.85 + random() * 0.3],
        });
      }
    }
    // 광장 가장자리 낮은 경계석(길이 들어오는 자리는 비운다)
    {
      const edge = PLAZA_RADIUS + 0.12;
      const n = Math.round((Math.PI * 2 * edge) / 0.78);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + random() * 0.03;
        const x = CAMPFIRE.x + Math.cos(a) * edge,
          z = CAMPFIRE.z + Math.sin(a) * edge;
        if (pathDistance(x, z) < 0.25) continue;
        pavers.push({
          x,
          y: GROUND_Y + 0.004,
          z,
          yaw: a + Math.PI / 2,
          s: [0.75 + random() * 0.2, 1.1, 0.55 + random() * 0.15],
        });
      }
    }
    for (const path of PATH_SAMPLES)
      path.samples.forEach(([x, z], i) => {
        if (i % 6 !== 0 || Math.hypot(x, z) < PLAZA_RADIUS + 0.5) return;
        const side = (i / 6) % 2 ? 0.28 : -0.28;
        pavers.push({
          x: x + side * path.width,
          y: GROUND_Y + 0.003,
          z,
          yaw: random() * 6.28,
          s: [0.75 + random() * 0.25, 1, 0.7 + random() * 0.25],
        });
      });
    // 모래사장 조약돌
    for (let k = 0; k < 140 && pebbles.length < 70; k++) {
      const a = random() * Math.PI * 2,
        rn = 0.955 + random() * 0.06;
      const x = Math.cos(a) * rn * 22,
        z = Math.sin(a) * rn * 20.4;
      if (Math.abs(x) < 2.2 && z > 0) continue;
      if (shoreDistance(x, z) > -0.25) continue;
      pebbles.push({
        x,
        y: GROUND_Y - 0.01,
        z,
        yaw: random() * 6.28,
        s: [0.22 + random() * 0.25, 1.4, 0.2 + random() * 0.2],
      });
    }
    return { grass, flowers, bushes, ferns, pavers, pebbles };
  }, []);
  return (
    <group>
      <Instances
        geometry={grassTuft()}
        material={grassMaterial}
        items={data.grass}
      />
      <Instances
        geometry={flowerStems()}
        material={flowerMaterial}
        items={data.flowers.map((f) => ({ ...f, color: undefined }))}
      />
      <Instances
        geometry={flowerPetals()}
        material={petalMaterial}
        items={data.flowers}
      />
      {data.bushes.map((items, i) => (
        <Instances
          key={i}
          geometry={bush(i)}
          material={bushMaterial}
          items={items}
          shadow
        />
      ))}
      <Instances geometry={fern()} material={bushMaterial} items={data.ferns} />
      <Instances
        geometry={paver()}
        material={instancedSolid}
        items={data.pavers}
      />
      <Instances
        geometry={paver()}
        material={instancedSolid}
        items={data.pebbles}
      />
    </group>
  );
}

// 나무는 카메라를 가리면 옅어져야 해서 그루마다 재질을 따로 둔다(공유하면 함께 옅어진다).
// 재질은 섬·그루별로 한 번만 만들어 두 섬을 오갈 때 다시 쓴다.
const treeMaterials = new Map<string, MeshStandardMaterial>();
const treeMaterial = (key: string) => {
  let m = treeMaterials.get(key);
  if (!m)
    treeMaterials.set(key, (m = swayMaterial(SWAY.tree, { roughness: 0.9 })));
  return m;
};
export function Forest({ island }: { island: "home" | "focus" }) {
  const trees = useMemo(
    () =>
      island === "home"
        ? TREES.map((tree, i) => ({
            ...tree,
            geometry: tree.pine ? pine(tree.variant) : broadleaf(tree.variant),
            material: treeMaterial(`home:${i}`),
          }))
        : FOCUS_TREES.map((tree, i) => ({
            ...tree,
            geometry:
              tree.kind === "willow"
                ? willow(tree.variant)
                : tree.kind === "pine"
                  ? pine(tree.variant)
                  : broadleaf(tree.variant),
            material: treeMaterial(`focus:${i}`),
          })),
    [island],
  );
  return (
    <group>
      {trees.map((tree) => (
        <group
          key={`${tree.x},${tree.z}`}
          position={[tree.x, GROUND_Y - 0.03, tree.z]}
          rotation={[0, tree.yaw, 0]}
          scale={tree.scale}
          userData={{ fadeWhenBlocking: true }}
        >
          <mesh
            geometry={tree.geometry}
            material={tree.material}
            castShadow
            receiveShadow
          />
        </group>
      ))}
    </group>
  );
}

export function WaterRocks() {
  const variants = useMemo(
    () =>
      [0, 1, 2].map((v) =>
        WATER_ROCKS.filter((r) => r.variant === v).map((r) => ({
          x: r.x,
          y: SEA_LEVEL - 0.6 * r.h,
          z: r.z,
          yaw: r.yaw,
          s: [r.r, r.h * 1.6, r.r * 0.9] as [number, number, number],
        })),
      ),
    [],
  );
  return (
    <group>
      {variants.map((items, v) => (
        <Instances
          key={v}
          geometry={rock(v)}
          material={instancedSolid}
          items={items}
          shadow
        />
      ))}
    </group>
  );
}

// 섬 위를 크게 도는 갈매기 네 마리
export function Seagulls({ reduced }: { reduced: boolean }) {
  const birds = useRef<(Group | null)[]>([]);
  const wings = useRef<(Group | null)[]>([]);
  const flock = useMemo(
    () =>
      [0, 1, 2, 3].map((i) => ({
        radius: 15 + i * 3.2,
        height: 8.5 + (i % 2) * 1.6,
        speed: 0.11 - i * 0.012,
        offset: i * 1.7,
      })),
    [],
  );
  useFrame(({ clock }) => {
    const t = reduced ? 0 : clock.elapsedTime;
    flock.forEach((f, i) => {
      const bird = birds.current[i];
      if (!bird) return;
      const a = t * f.speed + f.offset;
      bird.position.set(
        Math.cos(a) * f.radius,
        f.height + Math.sin(t * 0.7 + i) * 0.4,
        Math.sin(a) * f.radius * 0.9,
      );
      bird.rotation.set(0, -a, Math.sin(t * 0.5 + i) * 0.08 - 0.12);
      const flap = reduced ? 0.15 : Math.sin(t * 6 + i * 1.3) * 0.55;
      const left = wings.current[i * 2],
        right = wings.current[i * 2 + 1];
      if (left) left.rotation.z = flap;
      if (right) right.rotation.z = -flap;
    });
  });
  return (
    <group>
      {flock.map((_, i) => (
        <group key={i} ref={(g) => void (birds.current[i] = g)} scale={1.3}>
          <mesh geometry={gullBody()} material={solidMaterial} />
          <group
            ref={(g) => void (wings.current[i * 2] = g)}
            position={[0.08, 0.05, 0.02]}
          >
            <mesh geometry={gullWing()} material={solidMaterial} />
          </group>
          <group
            ref={(g) => void (wings.current[i * 2 + 1] = g)}
            position={[-0.08, 0.05, 0.02]}
            scale={[-1, 1, 1]}
          >
            <mesh geometry={gullWing()} material={solidMaterial} />
          </group>
        </group>
      ))}
    </group>
  );
}
