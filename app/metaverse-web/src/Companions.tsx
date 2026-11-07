import { useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Cat } from "./Cat";
import { IslandCompanions } from "./companion-motion";
import type { Simulation } from "./simulation";
import type { IslandId } from "./world";

export function Companions({
  island,
  sim,
}: {
  island: IslandId;
  sim: Simulation;
}) {
  const [friends] = useState(() => new IslandCompanions(island));
  useFrame((_, delta) => friends.step(delta, sim.actor, sim.reducedMotion), -1);
  return friends.actors.map((actor) => (
    <Cat
      key={actor.name}
      actor={actor}
      label={`${actor.name} · 봇`}
      reduced={sim.reducedMotion}
    />
  ));
}
