import { useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Cat } from "./Cat";
import { IslandCompanions } from "./companion-motion";
import type { Simulation } from "./simulation";
import type { IslandId } from "./world";

// 장면 친구. 이름표에는 이름만 쓴다. 산책 친구는 걷고 인사하며, 낚시섬의 집중 친구는
// 작은 섬 의자에서 물고기를 낚는다(어획 박자는 IslandCompanions가 서로 어긋나게 정한다).
export function Companions({
  island,
  sim,
}: {
  island: IslandId;
  sim: Simulation;
}) {
  const [friends] = useState(() => new IslandCompanions(island));
  useFrame((_, delta) => friends.step(delta, sim.actor, sim.reducedMotion), -1);
  return (
    <>
      {friends.actors.map((actor) => (
        <Cat key={actor.name} actor={actor} reduced={sim.reducedMotion} />
      ))}
      {friends.sitters.map(({ actor, fishing }) => (
        <Cat
          key={actor.name}
          actor={actor}
          fishing={fishing}
          reduced={sim.reducedMotion}
        />
      ))}
    </>
  );
}
