import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three-stdlib";
import { FOCUS_POND, getFocusSeat } from "./layout";
import type { Simulation } from "./simulation";

export type CameraMode = "follow" | "overview";
export type ZoomRequest = { id: number; direction: "in" | "out" };
export type SceneGesture = { suppressClickUntil: number };
type Transition = {
  from: Vector3;
  targetFrom: Vector3;
  to: Vector3;
  targetTo: Vector3;
  elapsed: number;
};
const ease = (t: number) => t * t * (3 - 2 * t);

// 프레임별 카메라 상태는 React 밖에 둔다. 클릭 이동·좌석 선택은 같은 제스처 판정을 쓴다.
export function CameraRig({
  sim,
  reset,
  onReady,
  cameraMode,
  activeSeatId,
  zoom,
  gesture,
}: {
  sim: Simulation;
  reset: number;
  onReady: () => void;
  cameraMode: CameraMode;
  activeSeatId: number | null;
  zoom: ZoomRequest;
  gesture: RefObject<SceneGesture>;
}) {
  const { camera, gl, size } = useThree();
  const mobile = size.width < 700;
  const controls = useMemo(
    () => new OrbitControls(camera as PerspectiveCamera),
    [camera],
  );
  const wasBlocked = useRef(false);
  const frames = useRef(0),
    initialized = useRef(false);
  const anchor = useRef(new Vector3()),
    pan = useRef(new Vector3());
  const lastTarget = useRef(new Vector3()),
    desired = useRef(new Vector3()),
    shift = useRef(new Vector3());
  const offset = useRef(new Vector3()),
    lastActor = useRef(new Vector3(sim.actor.x, 0, sim.actor.z));
  const transition = useRef<Transition | null>(null),
    zoomGoal = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>()),
    dragging = useRef(false);
  const view = useRef({ cameraMode, activeSeatId, mobile });
  view.current = { cameraMode, activeSeatId, mobile };
  const minDistance = activeSeatId === null ? 8 : 14;
  const maxDistance = mobile ? 165 : 90;
  controls.minDistance = minDistance;
  controls.maxDistance = maxDistance;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.18;
  controls.rotateSpeed = 0.55;
  controls.panSpeed = 0.7;
  controls.zoomSpeed = 0.7;
  controls.screenSpacePanning = false;

  // 시점 초기화 전에 남은 회전·이동 관성만 비운다. 화면 위치 자체는 유지한다.
  const clearInertia = () => {
    const position = camera.position.clone(),
      target = controls.target.clone();
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
    controls.enableDamping = !sim.reducedMotion;
  };
  const requestZoom = (factor: number) => {
    if (sim.blocked) return;
    transition.current = null;
    zoomGoal.current = MathUtils.clamp(
      (zoomGoal.current ?? controls.getDistance()) * factor,
      controls.minDistance,
      controls.maxDistance,
    );
  };
  const requestZoomRef = useRef(requestZoom);
  requestZoomRef.current = requestZoom;

  useLayoutEffect(() => {
    controls.connect(gl.domElement);
    const canvas = gl.domElement;
    const down = (e: PointerEvent) => {
      if (sim.blocked) return;
      transition.current = null;
      zoomGoal.current = null;
      controls.enabled = true;
      if (!pointers.current.size) {
        dragging.current = false;
        gesture.current.suppressClickUntil = 0;
      }
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (
        pointers.current.size > 1 ||
        e.button !== 0 ||
        e.shiftKey ||
        e.ctrlKey ||
        e.metaKey
      ) {
        dragging.current = true;
        gesture.current.suppressClickUntil = Infinity;
      }
    };
    const move = (e: PointerEvent) => {
      const start = pointers.current.get(e.pointerId);
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) {
        dragging.current = true;
        gesture.current.suppressClickUntil = Infinity;
      }
    };
    const up = (e: PointerEvent) => {
      if (!pointers.current.delete(e.pointerId)) return;
      if (!pointers.current.size && dragging.current)
        gesture.current.suppressClickUntil = performance.now() + 250;
    };
    const wheel = (e: WheelEvent) => {
      // OrbitControls의 이벤트 개수 기준 줌 대신 휠/트랙패드 실제 이동량을 정규화한다.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (sim.blocked) return;
      const pixels =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
      requestZoomRef.current(
        Math.exp(
          MathUtils.clamp(pixels, -180, 180) * (e.ctrlKey ? 0.006 : 0.0018),
        ),
      );
    };
    const blur = () => {
      pointers.current.clear();
      gesture.current.suppressClickUntil = performance.now() + 250;
      zoomGoal.current = null;
      clearInertia();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      sim.stop();
      window.dispatchEvent(new Event("cattus-context-lost"));
    };
    canvas.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    canvas.addEventListener("wheel", wheel, { capture: true, passive: false });
    canvas.addEventListener("webglcontextlost", lost);
    window.addEventListener("blur", blur);
    return () => {
      canvas.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      canvas.removeEventListener("wheel", wheel, true);
      canvas.removeEventListener("webglcontextlost", lost);
      window.removeEventListener("blur", blur);
      controls.dispose();
    };
  }, [controls, gl, sim, gesture]);

  useLayoutEffect(() => {
    clearInertia();
    pan.current.set(0, 0, 0);
    zoomGoal.current = null;
    const seat = activeSeatId === null ? undefined : getFocusSeat(activeSeatId);
    const target = new Vector3(0, 0.65, 1),
      position = new Vector3();
    if (cameraMode === "follow") {
      target.set(
        seat ? (sim.actor.x + FOCUS_POND.x) / 2 : sim.actor.x,
        0.65,
        seat ? (sim.actor.z + FOCUS_POND.z) / 2 : sim.actor.z,
      );
      const dx = seat ? seat.x - FOCUS_POND.x : 0,
        dz = seat ? seat.z - FOCUS_POND.z : 1;
      const radius = Math.hypot(dx, dz),
        distance = mobile ? 18 : 16;
      position.set(
        sim.actor.x + (dx / radius) * distance,
        mobile ? 12 : 10.8,
        sim.actor.z + (dz / radius) * distance,
      );
    } else {
      target.y = 0;
      position.set(mobile ? 60 : 30, mobile ? 84 : 48, mobile ? 108 : 56);
    }
    anchor.current.copy(target);
    if (!initialized.current || sim.reducedMotion) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      transition.current = null;
    } else
      transition.current = {
        from: camera.position.clone(),
        targetFrom: controls.target.clone(),
        to: position,
        targetTo: target,
        elapsed: 0,
      };
    lastTarget.current.copy(controls.target);
    initialized.current = true;
  }, [camera, controls, sim, reset, cameraMode, activeSeatId, mobile]);

  useEffect(() => {
    if (zoom.id)
      requestZoomRef.current(zoom.direction === "in" ? 0.82 : 1 / 0.82);
  }, [zoom.id]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05),
      c = controls;
    const { cameraMode: mode, activeSeatId: seatId } = view.current;
    sim.step(
      delta,
      Math.atan2(
        camera.position.x - c.target.x,
        camera.position.z - c.target.z,
      ),
      performance.now(),
    );
    const moved =
      Math.hypot(
        sim.actor.x - lastActor.current.x,
        sim.actor.z - lastActor.current.z,
      ) > 0.0001;
    lastActor.current.set(sim.actor.x, 0, sim.actor.z);
    c.enabled = !sim.blocked;
    c.enableDamping = !sim.reducedMotion;
    // 시뮬레이션 주기와 무관하게 같은 시간 동안 관성이 가라앉는다.
    c.dampingFactor = 1 - Math.exp(-12 * dt);
    if (sim.blocked) {
      if (!wasBlocked.current) {
        clearInertia();
        transition.current = null;
      }
      zoomGoal.current = null;
      pointers.current.clear();
    } else if (transition.current) {
      const t = transition.current;
      t.elapsed += dt;
      const progress = sim.reducedMotion ? 1 : Math.min(1, t.elapsed / 0.45);
      camera.position.lerpVectors(t.from, t.to, ease(progress));
      c.target.lerpVectors(t.targetFrom, t.targetTo, ease(progress));
      camera.lookAt(c.target);
      if (progress === 1) transition.current = null;
    } else {
      c.update();
      // 프레임 사이 OrbitControls가 바꾼 target은 사용자의 평면 이동이다.
      pan.current.add(shift.current.copy(c.target).sub(lastTarget.current));
      if (mode === "follow") {
        desired.current.set(sim.actor.x, 0.65, sim.actor.z);
        if (seatId !== null) {
          // 가까이 확대해도 의자 밖의 물만 보이지 않도록 시선 중심을 고양이 쪽으로 당긴다.
          const ahead = Math.min(
            0.5,
            Math.max(0.18, (c.getDistance() - 8) / 32),
          );
          desired.current.x += (FOCUS_POND.x - sim.actor.x) * ahead;
          desired.current.z += (FOCUS_POND.z - sim.actor.z) * ahead;
        }
        anchor.current.lerp(
          desired.current,
          sim.reducedMotion ? 1 : 1 - Math.exp(-9 * dt),
        );
        if (moved && !pointers.current.size)
          pan.current.multiplyScalar(sim.reducedMotion ? 0 : Math.exp(-5 * dt));
      } else anchor.current.set(0, 0, 1);
      pan.current.y = 0;
      pan.current.clampLength(0, mode === "follow" ? 12 : 24);
      desired.current.copy(anchor.current).add(pan.current);
      shift.current.copy(desired.current).sub(c.target);
      camera.position.add(shift.current);
      c.target.copy(desired.current);
      if (zoomGoal.current !== null) {
        const distance = c.getDistance(),
          goal = zoomGoal.current;
        const next = MathUtils.lerp(
          distance,
          goal,
          sim.reducedMotion ? 1 : 1 - Math.exp(-14 * dt),
        );
        offset.current.copy(camera.position).sub(c.target).setLength(next);
        camera.position.copy(c.target).add(offset.current);
        if (Math.abs(next - goal) < 0.005) zoomGoal.current = null;
      }
      camera.lookAt(c.target);
    }
    wasBlocked.current = sim.blocked;
    lastTarget.current.copy(c.target);
    camera.updateMatrixWorld();
    if (++frames.current === 2) onReady();
  }, -2);
  return null;
}
