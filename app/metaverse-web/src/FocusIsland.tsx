import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  DoubleSide,
  Group,
  MeshBasicMaterial,
  type MeshStandardMaterial,
} from "three";
import { Label } from "./Label";
import { FOCUS_LANDMARKS, FOCUS_TREE_POSITIONS } from "./layout";
import { Forest, Instances, WaterRocks, type Placement } from "./Scenery";
import { art } from "./theme";
import { fbm, rng } from "./assets3d/geometry";
import {
  bridgeGeometry,
  dragonflyBody,
  dragonflyWing,
  GRAMOPHONE_TOP,
  gramophoneParts,
  lilyPadGeometry,
  lotusGeometry,
  noteGeometry,
  recordGeometry,
  reedGeometry,
  shelterParts,
  WATERFALL_PLANTS,
  waterfallRocks,
} from "./assets3d/focusProps";
import { focusHeight, focusTerrainGeometry } from "./assets3d/focusTerrain";
import { Dock } from "./assets3d/Harbor";
import {
  bushMaterial,
  flowerMaterial,
  grassMaterial,
  instancedSolid,
  ownSolid,
  petalMaterial,
  reedMaterial,
  seaweedMaterial,
  solidMaterial,
  wind,
} from "./assets3d/materials";
import {
  bush,
  fern,
  flowerPetals,
  flowerStems,
  grassTuft,
  paver,
  rock,
} from "./assets3d/nature";
import { GROUND_Y } from "./assets3d/palette";
import {
  FALL_LIP,
  FOCUS_PATH_SAMPLES,
  focusOpenGround,
  GRAMOPHONE_YAW,
  landmarkClearance,
  POND,
  POND_DECOR,
  POND_LEVEL,
  SHELTER_YAW,
  streamX,
  STREAM_Z0,
} from "./assets3d/pond";
import { shoreDistance } from "./assets3d/shoreline";
import { PondWater, useWaterClock, WaterfallWater } from "./assets3d/water";

// 낚시섬. 바깥 해안·바다(Ocean)는 일반 섬과 같고, 섬 안은 연못과 물가 길, 북쪽 폭포,
// 서쪽 그늘 쉼터, 동쪽 축음기, 남쪽 뗏목 부두로 꾸민다. 의자 30개와 고양이는 Scene이 따로 그린다.
// 모든 geometry는 코드로 만든 절차적 모델이고 모듈에서 한 번 만들어 다시 쓴다(dispose={null}).
const FLOWER_TONES = [
  art.pink,
  art.butter,
  art.paper,
  "#F7B58F",
  art.sky,
  "#CDB8EC",
];
const BANK_TONES = ["#9CC8F0", "#CDB8EC", art.paper, "#F6D36B"];

let meadowCache: ReturnType<typeof buildMeadow> | null = null;
function buildMeadow() {
  const random = rng(2787);
  const grass: Placement[] = [],
    flowers: Placement[] = [],
    bushes: Placement[][] = [[], [], []],
    ferns: Placement[] = [],
    pavers: Placement[] = [],
    pebbles: Placement[] = [];
  const cell = 0.78;
  for (let x = -23; x <= 23; x += cell)
    for (let z = -21; z <= 21; z += cell) {
      const px = x + (random() - 0.5) * cell,
        pz = z + (random() - 0.5) * cell;
      if (!focusOpenGround(px, pz)) continue;
      const density = fbm(px * 0.12 + 40, pz * 0.12 - 3, 2);
      if (random() > 0.38 + density * 0.9) continue;
      if (shoreDistance(px, pz) > -2.2 && random() < 0.85) continue;
      grass.push({
        x: px,
        y: GROUND_Y - 0.01,
        z: pz,
        yaw: random() * 6.28,
        s: [
          0.85 + random() * 0.4,
          0.75 + random() * 0.8,
          0.85 + random() * 0.4,
        ],
        tilt: (random() - 0.5) * 0.2,
      });
    }
  // 물가 길 바깥, 의자 뒤 풀밭의 꽃무더기
  let clusters = 0;
  for (let i = 0; i < 600 && clusters < 54; i++) {
    const a = random() * Math.PI * 2,
      r = POND.path + 1.6 + random() * 7.4;
    const cx = Math.sin(a) * r,
      cz = Math.cos(a) * r * 0.93;
    if (!focusOpenGround(cx, cz, 0.2)) continue;
    clusters++;
    const tone = FLOWER_TONES[clusters % FLOWER_TONES.length];
    const n = 5 + Math.floor(random() * 6);
    for (let k = 0; k < n; k++) {
      const fx = cx + (random() - 0.5) * 1.5,
        fz = cz + (random() - 0.5) * 1.5;
      if (!focusOpenGround(fx, fz)) continue;
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
  // 물가 비탈 위의 작은 꽃(걷지 않는 비탈에만)
  for (const f of POND_DECOR.bankFlowers)
    flowers.push({
      x: f.x,
      y: focusHeight(f.x, f.z) - 0.01,
      z: f.z,
      yaw: f.yaw,
      s: f.s * 0.8,
      color: BANK_TONES[f.tone ?? 0],
    });
  // 나무 아래 덤불·고사리
  FOCUS_TREE_POSITIONS.forEach(([tx, tz], i) => {
    for (let k = 0; k < 2; k++) {
      const a = random() * Math.PI * 2,
        r = 0.75 + random() * 0.6;
      const x = tx + Math.cos(a) * r,
        z = tz + Math.sin(a) * r;
      if (landmarkClearance(x, z) < 0.3 || shoreDistance(x, z) > -0.5) continue;
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
  // 쉼터·축음기 둘레 덤불(앞쪽 연못 방향은 비운다)
  for (const [lm, yaw, reach] of [
    [FOCUS_LANDMARKS.shelter, SHELTER_YAW, 1.95],
    [FOCUS_LANDMARKS.gramophone, GRAMOPHONE_YAW, 1.45],
  ] as const)
    for (let k = 0; k < 5; k++) {
      if (reach < 1.5 && k % 2 === 1) continue;
      const a = yaw + Math.PI + (k - 2) * 0.62 + (random() - 0.5) * 0.2;
      const x = lm.x + Math.sin(a) * reach,
        z = lm.z + Math.cos(a) * reach;
      if (shoreDistance(x, z) > -0.4) continue;
      bushes[k % 3].push({
        x,
        y: GROUND_Y - 0.02,
        z,
        yaw: random() * 6.28,
        s: (reach < 1.5 ? 0.45 : 0.6) + random() * 0.25,
      });
    }
  // 폭포 바위 위·틈의 덤불과 고사리
  for (const p of WATERFALL_PLANTS)
    (p.fern ? ferns : bushes[1]).push({
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.x * 3,
      s: p.s,
    });
  // 길 위 디딤돌과 물길 옆 디딤돌
  for (const path of FOCUS_PATH_SAMPLES)
    path.samples.forEach(([x, z], i) => {
      if (i % 6 !== 0) return;
      const side = (i / 6) % 2 ? 0.28 : -0.28;
      pavers.push({
        x: x + side * path.width,
        y: GROUND_Y + 0.003,
        z,
        yaw: random() * 6.28,
        s: [0.75 + random() * 0.25, 1, 0.7 + random() * 0.25],
      });
    });
  for (let z = STREAM_Z0 + 0.4; z < -(POND.bank + 0.2); z += 0.55) {
    if (Math.abs(z + POND.bank + 0.62) < 0.7 || Math.abs(z + 14.55) < 0.7)
      continue;
    for (const s of [-1, 1]) {
      const x = streamX(z) + s * (0.5 + random() * 0.12);
      pebbles.push({
        x,
        y: GROUND_Y - 0.005,
        z,
        yaw: random() * 6.28,
        s: [0.32 + random() * 0.2, 1.6, 0.28 + random() * 0.15],
      });
    }
  }
  // 모래사장 조약돌
  for (let k = 0; k < 140 && pebbles.length < 110; k++) {
    const a = random() * Math.PI * 2,
      rn = 0.955 + random() * 0.06;
    const x = Math.cos(a) * rn * 22,
      z = Math.sin(a) * rn * 20.4;
    if (Math.abs(x) < 2.4 && z > 0) continue;
    if (shoreDistance(x, z) > -0.25) continue;
    pebbles.push({
      x,
      y: GROUND_Y - 0.01,
      z,
      yaw: random() * 6.28,
      s: [0.22 + random() * 0.25, 1.4, 0.2 + random() * 0.2],
    });
  }
  // 연못: 갈대·수련·연꽃·물가 돌·물속 수초
  const reeds: Placement[][] = [[], [], []];
  for (const r of POND_DECOR.reeds)
    reeds[r.tone ?? 0].push({
      x: r.x,
      y: Math.max(focusHeight(r.x, r.z), POND_LEVEL - 0.25) - 0.02,
      z: r.z,
      yaw: r.yaw,
      s: r.s,
      tilt: (random() - 0.5) * 0.12,
    });
  const lilies: Placement[] = [],
    lotus: Placement[] = [];
  for (const l of POND_DECOR.lilies) {
    lilies.push({
      x: l.x,
      y: POND_LEVEL + 0.012,
      z: l.z,
      yaw: l.yaw,
      s: [l.s, 1, l.s],
    });
    if (l.tone === 1)
      lotus.push({
        x: l.x + 0.08,
        y: POND_LEVEL + 0.012,
        z: l.z - 0.05,
        yaw: l.yaw,
        s: 0.9 + l.s,
      });
  }
  const stones: Placement[][] = [[], [], []];
  for (const s of POND_DECOR.bankStones)
    stones[s.tone ?? 0].push({
      x: s.x,
      y: focusHeight(s.x, s.z) - s.s * 0.25,
      z: s.z,
      yaw: s.yaw,
      s: [s.s, s.s * 0.62, s.s * 0.85],
    });
  const seaweed: Placement[] = POND_DECOR.waterGrass.map((w) => ({
    x: w.x,
    y: focusHeight(w.x, w.z) - 0.02,
    z: w.z,
    yaw: w.yaw,
    s: [
      w.s * 1.4,
      Math.min(w.s * 1.3, (POND_LEVEL - focusHeight(w.x, w.z)) / 0.36),
      w.s * 1.4,
    ],
  }));
  return {
    grass,
    flowers,
    bushes,
    ferns,
    pavers,
    pebbles,
    reeds,
    lilies,
    lotus,
    stones,
    seaweed,
  };
}
const meadow = () => (meadowCache ??= buildMeadow());

function FocusMeadow() {
  const data = meadow();
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
        items={useMemo(
          () => data.flowers.map((f) => ({ ...f, color: undefined })),
          [data],
        )}
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
      {data.reeds.map((items, i) => (
        <Instances
          key={i}
          geometry={reedGeometry(i)}
          material={reedMaterial}
          items={items}
          shadow
        />
      ))}
      {data.stones.map((items, i) => (
        <Instances
          key={i}
          geometry={rock(i)}
          material={instancedSolid}
          items={items}
          shadow
        />
      ))}
      <Instances
        geometry={grassTuft()}
        material={seaweedMaterial}
        items={data.seaweed}
      />
      <Instances
        geometry={lilyPadGeometry()}
        material={instancedSolid}
        items={data.lilies}
      />
      <Instances
        geometry={lotusGeometry()}
        material={instancedSolid}
        items={data.lotus}
      />
    </group>
  );
}

// 가리면 옅어지는 소품(쉼터·축음기·폭포 바위). 재질은 한 번만 만들어 섬을 오갈 때 다시 쓴다.
const fadeMaterials = new Map<
  string,
  { solid: MeshStandardMaterial; glow: MeshBasicMaterial }
>();
const ownMaterials = (key: string) => {
  let m = fadeMaterials.get(key);
  if (!m)
    fadeMaterials.set(
      key,
      (m = {
        solid: ownSolid(),
        glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      }),
    );
  return m;
};

function Shelter() {
  const parts = shelterParts();
  const m = ownMaterials("shelter");
  const s = FOCUS_LANDMARKS.shelter;
  return (
    <group position={[s.x, GROUND_Y, s.z]} rotation={[0, SHELTER_YAW, 0]}>
      <group userData={{ fadeWhenBlocking: true }}>
        <mesh
          geometry={parts.solid}
          material={m.solid}
          castShadow
          receiveShadow
        />
        <mesh geometry={parts.glow} material={m.glow} />
      </group>
      <Label position={[0, 0.55, 1.85]} text="그늘 쉼터" place />
    </group>
  );
}

const noteMaterials = [0, 1, 2].map(
  (i) =>
    new MeshBasicMaterial({
      color: [art.pink, art.sky, art.butter][i],
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    }),
);
// 축음기: 판이 천천히 돌고 나팔에서 음표가 피어오른다. 동작 줄이기에서는 멈추고 음표를 숨긴다.
function Gramophone({ reduced }: { reduced: boolean }) {
  const parts = gramophoneParts();
  const m = ownMaterials("gramophone");
  const record = useRef<Group>(null),
    notes = useRef<(Group | null)[]>([]);
  const g = FOCUS_LANDMARKS.gramophone;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (record.current) record.current.rotation.y = reduced ? 0 : -t * 2.1;
    notes.current.forEach((note, i) => {
      if (!note) return;
      note.visible = !reduced;
      const life = (t * 0.28 + i / 3) % 1;
      note.position.set(
        0.05 + Math.sin(life * 5 + i) * 0.12,
        1.55 + life * 0.9,
        0.7 + life * 0.35,
      );
      note.rotation.set(0, Math.sin(t + i) * 0.4, Math.sin(life * 6) * 0.2);
      noteMaterials[i].opacity = Math.sin(life * Math.PI) * 0.9;
    });
  });
  return (
    <group position={[g.x, GROUND_Y, g.z]} rotation={[0, GRAMOPHONE_YAW, 0]}>
      <group userData={{ fadeWhenBlocking: true }}>
        <mesh geometry={parts} material={m.solid} castShadow receiveShadow />
        <group ref={record} position={[0, GRAMOPHONE_TOP, 0]}>
          <mesh geometry={recordGeometry()} material={m.solid} />
        </group>
      </group>
      {[0, 1, 2].map((i) => (
        <group key={i} ref={(n) => void (notes.current[i] = n)} scale={1.15}>
          <mesh geometry={noteGeometry()} material={noteMaterials[i]} />
        </group>
      ))}
      <Label position={[0, 0.55, 1.05]} text="축음기" place />
    </group>
  );
}

function WaterfallRocks() {
  const m = ownMaterials("waterfall");
  return (
    <group userData={{ fadeWhenBlocking: true }}>
      <mesh
        geometry={waterfallRocks()}
        material={m.solid}
        castShadow
        receiveShadow
      />
    </group>
  );
}

// 연못 위를 맴돌다 잠깐 멈추는 잠자리 네 마리
const wingMaterial = new MeshBasicMaterial({
  color: "#EAF7F8",
  transparent: true,
  opacity: 0.7,
  depthWrite: false,
  side: DoubleSide,
});
function Dragonflies({ reduced }: { reduced: boolean }) {
  const flies = useRef<(Group | null)[]>([]),
    wings = useRef<(Group | null)[]>([]);
  const paths = useMemo(
    () =>
      [0, 1, 2, 3].map((i) => ({
        r: 3.2 + i * 1.6,
        h: 0.55 + (i % 2) * 0.35,
        speed: 0.21 + i * 0.04,
        offset: i * 1.9,
      })),
    [],
  );
  useFrame(({ clock }) => {
    const t = reduced ? 1.2 : clock.elapsedTime;
    paths.forEach((p, i) => {
      const fly = flies.current[i];
      if (!fly) return;
      // 움직였다 멈췄다 하는 비행: 위상을 계단처럼 진행한다
      const s = t * p.speed + p.offset;
      const hop = Math.floor(s) + Math.pow(s % 1, 3);
      const a = hop * 1.3;
      fly.position.set(
        Math.sin(a) * p.r,
        POND_LEVEL + p.h + Math.sin(t * 2.3 + i) * 0.05,
        Math.cos(a * 1.1) * p.r * 0.85,
      );
      fly.rotation.y = a + Math.PI / 2;
      for (const k of [0, 1]) {
        const w = wings.current[i * 2 + k];
        if (w)
          w.rotation.z =
            (k ? -1 : 1) * (reduced ? 0.15 : Math.sin(t * 40 + i) * 0.5);
      }
    });
  });
  return (
    <group>
      {paths.map((_, i) => (
        <group key={i} ref={(g) => void (flies.current[i] = g)} scale={1.6}>
          <mesh geometry={dragonflyBody()} material={solidMaterial} />
          {[0, 1].map((k) => (
            <group
              key={k}
              ref={(g) => void (wings.current[i * 2 + k] = g)}
              position={[0, 0.015, 0.035]}
              scale={[k ? -1 : 1, 1, 1]}
            >
              <mesh geometry={dragonflyWing()} material={wingMaterial} />
              <mesh
                geometry={dragonflyWing()}
                material={wingMaterial}
                position={[0, 0, -0.06]}
                rotation={[0, 0.25, 0]}
              />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

export const FocusIsland = memo(function FocusIsland({
  reduced,
}: {
  reduced: boolean;
}) {
  // 풀·나무 흔들림과 물 시간은 셰이더가 처리하고, 여기서는 시간 두 개만 넘긴다.
  useFrame(({ clock }) => {
    wind.value = reduced ? 2.2 : clock.elapsedTime;
  });
  useWaterClock(reduced);
  return (
    <group dispose={null}>
      <mesh
        geometry={focusTerrainGeometry()}
        material={solidMaterial}
        receiveShadow
      />
      <PondWater />
      <WaterfallRocks />
      <WaterfallWater reduced={reduced} />
      <mesh
        geometry={bridgeGeometry()}
        material={solidMaterial}
        castShadow
        receiveShadow
      />
      <FocusMeadow />
      <Forest island="focus" />
      <WaterRocks />
      <Shelter />
      <Gramophone reduced={reduced} />
      <Dock reduced={reduced} label="뗏목 부두" />
      <Dragonflies reduced={reduced} />
      <Label
        position={[FALL_LIP.x, FALL_LIP.y + 1.25, FALL_LIP.z]}
        text="폭포"
        place
      />
    </group>
  );
});
