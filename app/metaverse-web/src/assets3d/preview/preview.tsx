import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Cat } from "../../Cat";
import { FocusIsland } from "../../FocusIsland";
import { FocusSeats } from "../../FocusSeats";
import { Island, Ocean } from "../../Island";
import { LabelLayer } from "../../Label";
import {
  BUILDINGS,
  DOCK_POINT,
  FOCUS_LANDMARKS,
  FOCUS_POND,
  FOCUS_SEATS,
  FOCUS_SPAWN_POINT,
  REST_POINT,
} from "../../layout";
import { art } from "../../theme";
import {
  restSpot,
  type Actor,
  type CatColor,
  type IslandId,
} from "../../world";
import "../../style.css";

// 개발 서버에서만 여는 에셋 검토 화면. 운영 빌드(index.html)에는 포함되지 않는다.
//   /src/assets3d/preview/index.html?view=pond          낚시섬 연못 전체
//   ?view=seat&seat=0                                   실제 앱 따라가기 카메라(의자 뒤에서 연못)
//   ?view=all30                                         30석 모두 낚시 중
//   ?view=plaza                                         일반 섬 모닥불 광장
//   &reduced=1 동작 줄이기 · &cam=x,y,z&target=x,y,z 시점 지정 · &cats=0|10|30 앉은 수
const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "focus";
const reduced = params.get("reduced") === "1";
const colors: CatColor[] = [
  "cream",
  "peach",
  "gray",
  "black",
  "white",
  "brown",
];
const actions = ["idle", "wave", "sit", "fish"] as const;
type Shot = {
  island: IslandId;
  cam: [number, number, number];
  target: [number, number, number];
};
const seatParam = Number(params.get("seat") ?? 0);
const seat = FOCUS_SEATS[Math.max(0, Math.min(29, seatParam))];
const outward = (() => {
  const dx = seat.x - FOCUS_POND.x,
    dz = seat.z - FOCUS_POND.z,
    r = Math.hypot(dx, dz);
  return [dx / r, dz / r] as const;
})();
const fall = FOCUS_LANDMARKS.waterfall,
  shelter = FOCUS_LANDMARKS.shelter,
  gram = FOCUS_LANDMARKS.gramophone;
const views: Record<string, Shot> = {
  // 일반 섬
  island: { island: "home", cam: [30, 34, 44], target: [0, 0, 2] },
  plaza: { island: "home", cam: [0, 13, 15], target: [0, 0, 1] },
  cats: { island: "home", cam: [0, 2.2, 18.6], target: [0, 0.9, 12.2] },
  face: { island: "home", cam: [0, 1.4, 14.4], target: [0, 1.0, 12.2] },
  campfire: { island: "home", cam: [0, 3.2, 8.5], target: [0, 0.8, 0] },
  dock: { island: "home", cam: [7, 4.2, 30.5], target: [0, 0, 23.5] },
  hall: { island: "home", cam: [-8.5, 4.5, -1.5], target: [-12, 1.6, -11] },
  shop: { island: "home", cam: [15, 4.5, 0], target: [12, 1.4, -9] },
  lighthouse: { island: "home", cam: [9, 4.5, -8], target: [6, 3, -17] },
  mailbox: { island: "home", cam: [11.5, 2.2, 10.5], target: [14, 1, 7] },
  shore: { island: "home", cam: [-20, 5, 24], target: [-14, 0, 15] },
  // 낚시섬
  focus: { island: "focus", cam: [30, 34, 44], target: [0, 0, 1] },
  pond: { island: "focus", cam: [0, 26, 25], target: [0, 0, 0] },
  seat: {
    island: "focus",
    cam: [seat.x + outward[0] * 16, 10.8, seat.z + outward[1] * 16],
    target: [(seat.x + FOCUS_POND.x) / 2, 0.65, (seat.z + FOCUS_POND.z) / 2],
  },
  fishing: {
    island: "focus",
    cam: [
      seat.x + outward[0] * 2.4 + outward[1] * 3.6,
      2.6,
      seat.z + outward[1] * 2.4 - outward[0] * 3.6,
    ],
    target: [seat.x - outward[0] * 1.6, 0.9, seat.z - outward[1] * 1.6],
  },
  bank: { island: "focus", cam: [2.9, 2.2, 15.2], target: [0, 0.2, 9] },
  all30: { island: "focus", cam: [0, 30, 19], target: [0, 0, -1] },
  waterfall: {
    island: "focus",
    cam: [2.6, 3.4, -9.6],
    target: [0, 1.4, -16.6],
  },
  shelter: {
    island: "focus",
    cam: [-11.5, 3.6, 3.8],
    target: [shelter.x, 1.1, shelter.z],
  },
  gramophone: {
    island: "focus",
    cam: [14.2, 2.2, 2.6],
    target: [gram.x, 1.0, gram.z],
  },
  focusdock: { island: "focus", cam: [7, 4.2, 30.5], target: [0, 0, 22] },
  stream: { island: "focus", cam: [3.2, 4.6, -7.6], target: [0, 0, -13.2] },
};
const shot = views[view] ?? views.focus;
const island = (params.get("island") as IslandId | null) ?? shot.island;
const camParam = params.get("cam")?.split(",").map(Number) as
  [number, number, number] | undefined;
const targetParam = params.get("target")?.split(",").map(Number) as
  [number, number, number] | undefined;
const seatedCount = Number(
  params.get("cats") ?? (view === "all30" || view === "seat" ? 30 : 10),
);

function Walker({ actor }: { actor: Actor }) {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.6;
    actor.x = Math.cos(t) * 1.4 - 1.5;
    actor.z = Math.sin(t) * 1.4 + 15.8;
    actor.yaw = Math.atan2(-Math.sin(t), Math.cos(t));
  });
  return <Cat actor={actor} reduced={reduced} label="걷기" />;
}

// 일반 섬: 자세 모음, 부두 낚시, 회관 앞 인사, 모닥불 휴식 주민
function HomeCast() {
  const lineup = useMemo(
    () =>
      actions.map((action, i): Actor => ({
        island: "home",
        x: -4.5 + i * 2.2,
        z: 12.2,
        yaw: 0,
        action,
        color: colors[i],
        name: action,
      })),
    [],
  );
  const extras = useMemo<Actor[]>(
    () => [
      {
        island: "home",
        ...DOCK_POINT,
        yaw: 0,
        action: "fish",
        color: "gray",
        name: "부두 낚시",
      },
      {
        island: "home",
        x: BUILDINGS.hall.entrance.x,
        z: BUILDINGS.hall.entrance.z,
        yaw: Math.PI,
        action: "wave",
        color: "peach",
        name: "인사",
      },
      ...[0, 3, 7, 12, 18, 24].map((id, i): Actor => {
        const spot = restSpot(id);
        return {
          island: "home",
          ...spot,
          action: "sit",
          color: colors[i % 6],
          name: `휴식 ${id}`,
        };
      }),
      {
        island: "home",
        ...REST_POINT,
        yaw: Math.PI,
        action: "sit",
        color: "white",
        name: "모닥불",
      },
    ],
    [],
  );
  const walker = useMemo<Actor>(
    () => ({
      island: "home",
      x: 0,
      z: 15,
      yaw: 0,
      action: "walk",
      color: "black",
      name: "walk",
    }),
    [],
  );
  return (
    <>
      {[...lineup, ...extras].map((actor) => (
        <Cat
          key={actor.name}
          actor={actor}
          reduced={reduced}
          label={actor.name}
        />
      ))}
      <Walker actor={walker} />
    </>
  );
}

// 낚시섬: 의자에 앉아 낚시하는 고양이(기본 10명, cats=30이면 전부), 도착한 고양이 하나
function FocusCast({ occupied }: { occupied: ReadonlyMap<number, string> }) {
  const sitters = useMemo(
    () =>
      FOCUS_SEATS.filter((s) => occupied.has(s.id)).map((s, i): Actor => ({
        island: "focus",
        x: s.x,
        z: s.z,
        yaw: s.yaw,
        action: "focus",
        color: colors[i % 6],
        name: occupied.get(s.id)!,
        seatId: s.id,
      })),
    [occupied],
  );
  const visitor = useMemo<Actor>(
    () => ({
      island: "focus",
      ...FOCUS_SPAWN_POINT,
      yaw: Math.PI,
      action: "wave",
      color: "peach",
      name: "도착",
    }),
    [],
  );
  return (
    <>
      {sitters.map((actor) => (
        <Cat
          key={actor.name}
          actor={actor}
          reduced={reduced}
          label={actor.name}
        />
      ))}
      <Cat actor={visitor} reduced={reduced} />
    </>
  );
}

function App() {
  const labels = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(seat.id);
  const occupied = useMemo(() => {
    const step =
      seatedCount >= 30
        ? 1
        : seatedCount <= 0
          ? 0
          : Math.round(30 / seatedCount);
    return new Map(
      step === 0
        ? []
        : FOCUS_SEATS.filter((s) => s.id % step === seat.id % step).map((s) => [
            s.id,
            s.id === seat.id ? "나" : `고양이 ${s.id + 1}`,
          ]),
    );
  }, []);
  return (
    <>
      <div className="scene-labels" ref={labels} />
      <Canvas
        shadows
        dpr={[1, 1.6]}
        camera={{
          position: camParam ?? shot.cam,
          fov: 38,
          near: 0.1,
          far: 400,
        }}
      >
        <LabelLayer.Provider value={labels}>
          <color attach="background" args={[art.ocean]} />
          <fog attach="fog" args={[art.ocean, 170, 330]} />
          <ambientLight intensity={0.7} />
          <hemisphereLight args={[art.paper, art.timber, 0.7]} />
          <directionalLight
            position={[-18, 34, 20]}
            intensity={2}
            color={art.paper}
            castShadow
            shadow-mapSize={2048}
            shadow-camera-left={-30}
            shadow-camera-right={30}
            shadow-camera-top={30}
            shadow-camera-bottom={-30}
            shadow-normalBias={0.06}
          />
          <Ocean reduced={reduced} />
          {island === "home" ? (
            <>
              <Island reduced={reduced} />
              <HomeCast />
            </>
          ) : (
            <>
              <FocusIsland reduced={reduced} />
              <FocusSeats
                occupied={occupied}
                activeSeatId={active}
                pendingSeatId={(seat.id + 4) % 30}
                onSelect={(id) => setActive(id)}
              />
              <FocusCast occupied={occupied} />
            </>
          )}
          <OrbitControls target={targetParam ?? shot.target} />
        </LabelLayer.Provider>
      </Canvas>
      <output
        id="preview-ready"
        data-view={view}
        data-island={island}
        style={{
          position: "fixed",
          left: 8,
          bottom: 8,
          font: "12px sans-serif",
          color: "#493B39",
          background: "#FFFDFACC",
          padding: "2px 6px",
          borderRadius: 6,
        }}
      >
        {island === "home" ? "일반 섬" : "낚시섬"} · {view}
        {reduced ? " · 동작 줄이기" : ""}
      </output>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
