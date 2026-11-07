import {
  arrivalActor,
  createActor,
  DOCK,
  moveSafe,
  pathTo,
  sanitizeActor,
  seatExit,
  validActor,
  type Action,
  type Actor,
  type Point,
} from "./world";
// 내 고양이의 로컬 이동. 섬·좌석·집중 자세는 서버 응답(applyAuthoritativeActor)만 바꾼다.
export class Simulation {
  actor: Actor = createActor();
  path: Point[] = [];
  keys = new Set<string>();
  stick = { x: 0, z: 0 };
  blocked = false;
  reducedMotion = false;
  arrival: Action = "idle";
  emoteUntil = 0;
  moveTo(target: Point, arrival: Action = "idle") {
    if (this.actor.action === "focus" || arrival === "focus") return false;
    const path = pathTo(this.actor, target, this.actor.island);
    if (!path.length) return false;
    this.path = path;
    this.arrival = arrival;
    this.actor.action = "walk";
    return true;
  }
  action(action: Action) {
    if (this.actor.action === "focus" || action === "focus") return false;
    // 부두 낚시는 일반 섬의 뗏목 부두에서만 한다. 낚시섬 집중은 의자 명령으로만 시작한다.
    if (action === "fish")
      return this.actor.island === "home" && this.moveTo(DOCK, "fish");
    this.path = [];
    this.arrival = "idle";
    this.actor.action = action;
    this.emoteUntil = performance.now() + 2400;
    return true;
  }
  /**
   * 서버가 확정한 내 Actor를 그대로 반영한다. 이름·털색은 내가 고른 값을 유지하고,
   * 걷던 경로·키 입력·도착 행동은 버린다. 잘못된 값이면 아무것도 바꾸지 않는다.
   */
  applyAuthoritativeActor(next: unknown): boolean {
    if (!validActor(next)) return false;
    this.replaceActor({
      ...sanitizeActor(next),
      name: this.actor.name,
      color: this.actor.color,
    });
    return true;
  }
  /** 새 연결·연결 끊김: 이전 좌석·좌표 없이 일반 섬 시작점으로 돌아간다. */
  resetToHome() {
    this.replaceActor(arrivalActor("home", this.actor));
  }
  // 장면의 Cat이 같은 객체를 매 프레임 읽으므로 참조를 유지한 채 필드만 바꾼다.
  private replaceActor(next: Actor) {
    delete this.actor.seatId;
    Object.assign(this.actor, next);
    this.clearMotion();
  }
  /** 비상 취소. 의자에 있었다면 의자 옆으로 일어서고, 아니면 현재 섬에서 멈춘다. */
  leaveSeat(): void {
    if (this.actor.action === "focus" && this.actor.seatId !== undefined) {
      const exit = seatExit(this.actor.seatId);
      this.actor.x = exit.x;
      this.actor.z = exit.z;
    }
    delete this.actor.seatId;
    this.clearMotion();
    this.actor.action = "idle";
  }
  clearInput() {
    this.keys.clear();
    this.stick = { x: 0, z: 0 };
  }
  stop() {
    this.clearInput();
    this.path = [];
    if (this.actor.action === "walk") this.actor.action = "idle";
  }
  private clearMotion() {
    this.clearInput();
    this.path = [];
    this.arrival = "idle";
    this.emoteUntil = 0;
  }
  step(delta: number, cameraYaw: number, now: number) {
    if (this.blocked || this.actor.action === "focus") return;
    const island = this.actor.island;
    const dt = Math.min(delta, 0.05);
    const x =
      Number(this.keys.has("d") || this.keys.has("arrowright")) -
      Number(this.keys.has("a") || this.keys.has("arrowleft")) +
      this.stick.x;
    const z =
      Number(this.keys.has("s") || this.keys.has("arrowdown")) -
      Number(this.keys.has("w") || this.keys.has("arrowup")) +
      this.stick.z;
    let dx = 0,
      dz = 0;
    if (Math.hypot(x, z) > 0.1) {
      const length = Math.max(1, Math.hypot(x, z));
      dx = (x * Math.cos(cameraYaw) + z * Math.sin(cameraYaw)) / length;
      dz = (-x * Math.sin(cameraYaw) + z * Math.cos(cameraYaw)) / length;
      this.path = [];
      this.arrival = "idle";
    } else if (this.path.length) {
      const target = this.path[0],
        distance = Math.hypot(target.x - this.actor.x, target.z - this.actor.z);
      if (distance < 0.08) this.path.shift();
      else {
        dx = (target.x - this.actor.x) / distance;
        dz = (target.z - this.actor.z) / distance;
        const ratio = Math.min(1, distance / (dt * 3.2));
        dx *= ratio;
        dz *= ratio;
      }
    }
    if (dx || dz) {
      const before = { x: this.actor.x, z: this.actor.z };
      let next = moveSafe(
        before,
        { x: before.x + dx * dt * 3.2, z: before.z + dz * dt * 3.2 },
        island,
      );
      if (next.x === before.x && next.z === before.z && !this.path.length) {
        next = moveSafe(
          before,
          { x: before.x + dx * dt * 3.2, z: before.z },
          island,
        );
        next = moveSafe(
          next,
          { x: next.x, z: before.z + dz * dt * 3.2 },
          island,
        );
      }
      this.actor.x = next.x;
      this.actor.z = next.z;
      this.actor.yaw = Math.atan2(dx, dz);
      this.actor.action =
        Math.hypot(next.x - before.x, next.z - before.z) > 0.001
          ? "walk"
          : "idle";
    } else if (this.actor.action === "walk" && this.path.length === 0) {
      this.actor.action = this.arrival;
      if (this.arrival === "fish") this.actor.yaw = 0;
    }
    if (this.actor.action === "wave" && now > this.emoteUntil)
      this.actor.action = "idle";
  }
}
