import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, Raycaster, Vector3, type Material, type Object3D } from "three";
import type { Simulation } from "./simulation";

type Occluder = { object: Object3D; materials: Material[]; fade: boolean };
export function CameraOcclusion({
  sim,
  follow,
}: {
  sim: Simulation;
  follow: boolean;
}) {
  const { scene, camera } = useThree();
  const groups = useRef<Occluder[]>([]),
    ray = useRef(new Raycaster()),
    point = useRef(new Vector3()),
    direction = useRef(new Vector3()),
    last = useRef(0);
  useEffect(() => {
    const items: Occluder[] = [];
    scene.traverse((object) => {
      if (!object.userData.fadeWhenBlocking) return;
      const materials: Material[] = [];
      object.traverse((child) => {
        if (child instanceof Mesh) {
          const values = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.push(...values);
        }
      });
      items.push({ object, materials, fade: false });
    });
    groups.current = items;
    return () => {
      for (const group of items)
        for (const material of group.materials) {
          material.opacity = 1;
          material.transparent = false;
          material.depthWrite = true;
        }
    };
  }, [scene]);
  useFrame(({ clock }, delta) => {
    if (clock.elapsedTime - last.current > 0.1) {
      last.current = clock.elapsedTime;
      point.current.set(sim.actor.x, 1.1, sim.actor.z);
      direction.current.copy(point.current).sub(camera.position);
      ray.current.set(camera.position, direction.current.normalize());
      ray.current.far = camera.position.distanceTo(point.current) - 0.4;
      for (const group of groups.current)
        group.fade =
          follow && ray.current.intersectObject(group.object, true).length > 0;
    }
    for (const group of groups.current)
      for (const material of group.materials) {
        const desired = group.fade ? 0.25 : 1;
        material.opacity +=
          (desired - material.opacity) *
          (sim.reducedMotion ? 1 : 1 - Math.exp(-10 * Math.min(delta, 0.1)));
        const transparent = material.opacity < 0.995;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.depthWrite = !transparent;
      }
  });
  return null;
}
