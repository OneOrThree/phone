import { Suspense, useEffect, useState, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Cat } from "./Cat";
import { Companions } from "./Companions";
import { CameraOcclusion } from "./CameraOcclusion";
import { Island, Ocean } from "./Island";
import { FocusSeats } from "./FocusSeats";
import { FocusIsland } from "./FocusIsland";
import type { IslandId } from "./focus-session";
import { LabelLayer } from "./Label";
import { art } from "./theme";
import { CameraRig, type SceneGesture, type ZoomRequest } from "./CameraRig";
import type { Simulation } from "./simulation";
import type { Resident } from "./world";
export function Scene({
  island,
  sim,
  residents,
  reset,
  zoom,
  onReady,
  onMove,
  lowQuality,
  cameraMode,
  occupied,
  activeSeatId,
  pendingSeatId,
  onSelectSeat,
}: {
  island: IslandId;
  sim: Simulation;
  residents: Resident[];
  reset: number;
  zoom: ZoomRequest;
  onReady: () => void;
  onMove: (ok: boolean) => void;
  lowQuality: boolean;
  cameraMode: "follow" | "overview";
  occupied: ReadonlyMap<number, string>;
  activeSeatId: number | null;
  pendingSeatId: number | null;
  onSelectSeat: (seatId: number) => void;
}) {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  const labels = useRef<HTMLDivElement>(null);
  const gesture = useRef<SceneGesture>({ suppressClickUntil: 0 });
  return (
    <>
      <div className="scene-labels" ref={labels} />
      <Canvas
        frameloop={visible ? "always" : "never"}
        shadows={!lowQuality}
        dpr={lowQuality ? 1 : [1, 1.6]}
        camera={{ position: [17, 23, 27], fov: 38, near: 0.1, far: 400 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
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
            castShadow={!lowQuality}
            shadow-mapSize={lowQuality ? 1024 : 2048}
            shadow-camera-left={-30}
            shadow-camera-right={30}
            shadow-camera-top={30}
            shadow-camera-bottom={-30}
            shadow-normalBias={0.06}
          />
          <Suspense fallback={null}>
            <Ocean reduced={sim.reducedMotion} />
            {island === "home" ? (
              <Island reduced={sim.reducedMotion} />
            ) : (
              <>
                <FocusIsland reduced={sim.reducedMotion} />
                <FocusSeats
                  occupied={occupied}
                  activeSeatId={activeSeatId}
                  pendingSeatId={pendingSeatId}
                  onSelect={(id) => {
                    if (performance.now() >= gesture.current.suppressClickUntil)
                      onSelectSeat(id);
                  }}
                />
              </>
            )}
            <mesh
              position={[0, 0.115, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                if (
                  e.button !== 0 ||
                  e.delta > 5 ||
                  sim.blocked ||
                  performance.now() < gesture.current.suppressClickUntil
                )
                  return;
                e.stopPropagation();
                onMove(sim.moveTo({ x: e.point.x, z: e.point.z }));
              }}
            >
              <planeGeometry args={[60, 60]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <Cat
              key={`local:${island}`}
              actor={sim.actor}
              local
              reduced={sim.reducedMotion}
            />
            <Companions
              key={`companions:${island}`}
              island={island}
              sim={sim}
            />
            {residents
              .filter((actor) => actor.island === island)
              .map((actor) => (
                <Cat
                  key={`${island}:${actor.id}`}
                  actor={actor}
                  reduced={sim.reducedMotion}
                />
              ))}
            {sim.path.length > 0 && (
              <mesh
                position={[sim.path.at(-1)!.x, 0.13, sim.path.at(-1)!.z]}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <ringGeometry args={[0.22, 0.31, 32]} />
                <meshBasicMaterial color={art.paper} />
              </mesh>
            )}
            <CameraOcclusion
              key={`occlusion:${island}`}
              sim={sim}
              follow={cameraMode === "follow"}
            />
            <CameraRig
              key={`runtime:${island}`}
              sim={sim}
              reset={reset}
              zoom={zoom}
              gesture={gesture}
              onReady={onReady}
              cameraMode={cameraMode}
              activeSeatId={activeSeatId}
            />
          </Suspense>
        </LabelLayer.Provider>
      </Canvas>
    </>
  );
}
