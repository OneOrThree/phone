/**
 * 섬 이동 동기화 1단계(GROMO-2248) — 서버 확정 경로 채택과 다른 주민 보간. 네트워크·React 를 모르는 순수 로직이다.
 *
 * 계약 정본: `doc/movement-sync-2026-10-09/contract.md` §2·§3, PRD `docs/prd/fishcat/island-movement/`
 * (high-level-design §5, data-flow §2, protocol §0).
 *  - 좌표는 전부 월드 [0,100]² 실수. 목적지는 소수 2자리로 반올림해 보낸다.
 *  - FullState 전(ready 전)에는 목적지를 보내지 않는다 — 로컬 걷기만 하고, ready 가 되면 마지막 목적지 하나만 보낸다.
 *  - PathAccepted 로 알게 된 경로(pathId)의 스냅샷만 보간한다 — 모르는 경로는 추측하지 않는다.
 *  - 상태는 React state 가 아니라 이 객체와 콜백으로 흐른다(20Hz setState 금지, HLD §5).
 */
import { isInsideWorld, type WorldPoint } from '@/utils/worldCoords';

/** 앱 → 서버 `SEND /app/islands/{id}/movement/intent` 본문. */
export type MoveIntent = { commandSeq: number; navRevision: number; goalX: number; goalY: number };
/** FullState·Snapshot 의 actor. state 는 서버 값 그대로(IDLE·MOVING). */
export type MovementActor = {
  userId: string;
  x: number;
  y: number;
  state: string;
  pathId: number;
  lastCommandSeq: number;
};
export type RemotePosition = WorldPoint & { moving: boolean };

/** 렌더는 받은 최신 서버 틱보다 2틱(100ms) 뒤를 그린다. */
export const RENDER_DELAY_TICKS = 2;
/** 샘플이 6틱(300ms) 이상 끊기면 보간하지 않고 마지막 점에 세운다. */
export const GAP_TICKS = 6;
/** 주민별로 보관하는 최근 샘플 수. */
export const MAX_SAMPLES = 8;
/** 서버의 내 위치가 표시 위치와 이보다 멀면(월드 unit) 즉시 맞춘다 — 작은 오차는 무시해 보정 선분이 장애물을 지나지 않게. */
export const CORRECTION_UNITS = 1;
/** 목적지를 보낸 뒤 이 시간 안에 서버 응답(PathAccepted·MoveRejected)이 없으면 서버 대기로 본다. 로컬 걷기는 그대로다. */
export const SERVER_LAG_MS = 2000;
// FullState 의 내 위치 채택은 반올림 오차만 넘으면 맞춘다(스폰 차이 보정 — 1 unit 보다 작다).
const ADOPT_UNITS = 0.01;
// 다른 주민 보간 애니메이션 한 틱 = 50ms(GAP_TICKS 주석과 같은 기준: 300ms = GAP_TICKS(6)×50ms).
const REMOTE_TICK_MS = 50;

const round2 = (v: number) => Math.round(v * 100) / 100;
const dist = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const point = (v: unknown): WorldPoint | null => {
  const r = v as { x?: unknown; y?: unknown } | null;
  const x = num(r?.x),
    y = num(r?.y);
  return x === null || y === null ? null : { x, y };
};
const points = (v: unknown): WorldPoint[] | null => {
  if (!Array.isArray(v)) return null;
  const out: WorldPoint[] = [];
  for (const raw of v) {
    const p = point(raw);
    if (!p) return null;
    out.push(p);
  }
  return out;
};
const actorOf = (v: unknown): MovementActor | null => {
  const r = v as Record<string, unknown> | null;
  const userId = str(r?.userId),
    at = point(r),
    pathId = num(r?.pathId),
    lastCommandSeq = num(r?.lastCommandSeq);
  if (!userId || !at || pathId === null || lastCommandSeq === null) return null;
  return { userId, ...at, state: str(r?.state) ?? 'IDLE', pathId, lastCommandSeq };
};

type Polyline = { pts: WorldPoint[]; acc: number[] };
const polyline = (pts: WorldPoint[]): Polyline => {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, acc };
};
// p 를 폴리라인 위 가장 가까운 점으로 투영한다 — 그 점까지의 누적 거리와 선분 번호. 동률은 앞 선분.
const project = ({ pts, acc }: Polyline, p: WorldPoint) => {
  let best = { along: 0, segment: 0, d2: Infinity };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i],
      dx = pts[i + 1].x - a.x,
      dy = pts[i + 1].y - a.y,
      len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d2 = (p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2;
    if (d2 < best.d2) best = { along: acc[i] + Math.sqrt(len2) * t, segment: i, d2 };
  }
  return best;
};
// 폴리라인 시작부터 거리 d 인 점 — 결과는 항상 폴리라인 위다(건물 모서리를 가로지르지 않는다).
const pointAt = ({ pts, acc }: Polyline, d: number): WorldPoint => {
  for (let i = 0; i + 1 < pts.length; i++) {
    if (d > acc[i + 1]) continue;
    const len = acc[i + 1] - acc[i];
    const t = len ? Math.max(0, (d - acc[i]) / len) : 0;
    return {
      x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
      y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
    };
  }
  return pts[pts.length - 1];
};

/** 두 경로가 같은 셀 열을 지나는지(셀 = floor). 로컬 A* 경로와 PathAccepted waypoints 비교용. */
export const sameCells = (a: readonly WorldPoint[], b: readonly WorldPoint[]) =>
  a.length === b.length &&
  a.every(
    (p, i) => Math.floor(p.x) === Math.floor(b[i].x) && Math.floor(p.y) === Math.floor(b[i].y),
  );

/**
 * 경로(출발점 포함)에서 from 을 가장 가까운 선분에 투영하고 그 뒤에 남은 꼭짓점만 돌려준다.
 * 걷는 도중 서버 경로로 갈아탈 때 이미 지나온 꼭짓점으로 되돌아가지 않게 한다.
 * from → 첫 꼭짓점의 연결 구간은 직선이 아닐 수 있다 — 호출자가 통행 가능한 경로로 잇는다.
 */
export function remainingPath(path: readonly WorldPoint[], from: WorldPoint): WorldPoint[] {
  if (path.length < 2) return [];
  return path.slice(project(polyline([...path]), from).segment + 1);
}

type Sample = {
  serverTick: number;
  pathId: number;
  x: number;
  y: number;
  segmentIndex: number;
  moving: boolean;
  /** 이 샘플을 자기 경로 폴리라인에 투영한 누적 거리 — 보간은 이 거리로 한다. */
  along: number;
};
type Track = {
  samples: Sample[];
  paths: Map<number, Polyline>;
  latestPathId: number;
  arrivedPathId: number | null;
  fixed: WorldPoint | null;
};

/**
 * 다른 주민 스냅샷 버퍼 — 주민별 최근 샘플 ≤ 8개, PathAccepted 로 등록된 경로의 샘플만 받는다.
 * `positionAt(userId, latestTick − 2)` 는 두 샘플을 경로 위 누적 거리로 바꿔 보간한 뒤 경로 위 점으로 되돌린다.
 */
export class SnapshotBuffer {
  private tracks = new Map<string, Track>();

  private track(userId: string): Track {
    let t = this.tracks.get(userId);
    if (!t) {
      t = { samples: [], paths: new Map(), latestPathId: 0, arrivedPathId: null, fixed: null };
      this.tracks.set(userId, t);
    }
    return t;
  }

  /** PathAccepted — 출발점 + waypoints 를 이 pathId 의 폴리라인으로 등록한다. */
  addPath(userId: string, pathId: number, path: WorldPoint[]): void {
    const t = this.track(userId);
    t.paths.set(pathId, polyline(path));
    t.latestPathId = Math.max(t.latestPathId, pathId);
    // ponytail: 경로는 주민당 8개까지(샘플 8개가 가리킬 수 있는 최대). 넘치면 가장 먼저 등록된 것부터 버린다.
    if (t.paths.size > MAX_SAMPLES) t.paths.delete(t.paths.keys().next().value as number);
  }

  /** 모르는 pathId·이미 도착한 경로·latestPathId 보다 오래된 경로·지난 틱의 샘플은 버린다(false). */
  push(userId: string, s: Omit<Sample, 'along'>): boolean {
    const t = this.tracks.get(userId);
    const line = t?.paths.get(s.pathId);
    if (!t || !line || s.pathId === t.arrivedPathId || s.pathId < t.latestPathId) return false;
    const last = t.samples[t.samples.length - 1];
    if (last && s.serverTick <= last.serverTick) return false;
    t.fixed = null;
    t.samples.push({ ...s, along: project(line, s).along });
    if (t.samples.length > MAX_SAMPLES) t.samples.shift();
    return true;
  }

  /** Arrived — 그 자리에 고정하고 샘플을 비운다. 이미 더 새 경로를 받았으면 무시(false). */
  arrive(userId: string, pathId: number, at: WorldPoint): boolean {
    const t = this.track(userId);
    if (pathId < t.latestPathId) return false;
    t.latestPathId = pathId;
    t.arrivedPathId = pathId;
    t.fixed = at;
    t.samples = [];
    return true;
  }

  /** FullState 의 actor 집합만 남긴다. */
  retain(userIds: ReadonlySet<string>): void {
    for (const userId of [...this.tracks.keys()])
      if (!userIds.has(userId)) this.tracks.delete(userId);
  }

  /** serverTick 역행(서버·방 재시작)일 때만 — 모든 주민 트랙을 통째로 비운다. */
  clear(): void {
    this.tracks.clear();
  }

  /**
   * FullState 의 actor.pathId 가 이 주민 트랙의 latestPathId 보다 작으면(서버 재시작 등으로 pathId 가
   * 되돌아간 경우) 판정 상태(latestPathId·arrivedPathId)만 되돌린다 — 샘플·경로는 그대로 둬 정상 FullState 에서
   * 걷는 주민이 다음 PathAccepted 전까지 멈추지 않는다.
   */
  resetIf(userId: string, pathId: number): void {
    const t = this.tracks.get(userId);
    if (t && pathId < t.latestPathId) {
      t.latestPathId = pathId;
      t.arrivedPathId = null;
    }
  }

  positionAt(userId: string, renderTick: number): RemotePosition | null {
    const p = this.positionAtTimed(userId, renderTick);
    return p && { x: p.x, y: p.y, moving: p.moving };
  }

  /** positionAt 과 같지만 보간에 쓴 두 샘플의 틱 간격 기반 애니메이션 길이(durationMs)도 함께 돌려준다. */
  positionAtTimed(
    userId: string,
    renderTick: number,
  ): (RemotePosition & { durationMs: number }) | null {
    const t = this.tracks.get(userId);
    if (!t) return null;
    if (t.fixed) return { ...t.fixed, moving: false, durationMs: REMOTE_TICK_MS };
    const s = t.samples;
    if (!s.length) return null;
    const at = (x: Sample, moving: boolean) => ({
      x: x.x,
      y: x.y,
      moving,
      durationMs: REMOTE_TICK_MS,
    });
    const last = s[s.length - 1];
    // 데이터 끝 너머는 외삽하지 않는다. 300ms 넘게 끊기면 걷는 자세도 멈춘다.
    if (renderTick >= last.serverTick)
      return at(last, last.moving && renderTick - last.serverTick < GAP_TICKS);
    const j = s.findIndex((x) => x.serverTick > renderTick);
    if (j === 0) return at(s[0], s[0].moving);
    const a = s[j - 1],
      b = s[j];
    if (b.serverTick - a.serverTick >= GAP_TICKS) return at(a, false);
    const line = a.pathId === b.pathId ? t.paths.get(a.pathId) : undefined;
    if (!line) return at(a, a.moving);
    const f = (renderTick - a.serverTick) / (b.serverTick - a.serverTick);
    return {
      ...pointAt(line, a.along + (b.along - a.along) * f),
      moving: a.moving,
      // 저주기 스냅샷(예: 5Hz)도 다음 호출까지 매끄럽게 잇도록 — 1틱(50ms)~GAP_TICKS 틱(300ms) 사이로 clamp.
      durationMs: Math.min(
        GAP_TICKS * REMOTE_TICK_MS,
        Math.max(REMOTE_TICK_MS, (b.serverTick - a.serverTick) * REMOTE_TICK_MS),
      ),
    };
  }
}

export type MovementCallbacks = {
  /** 내 최신 명령의 PathAccepted — 출발 제외 셀 중심 열(월드)·서버 속도(unit/s)·서버 출발점. */
  onMyPath?: (waypoints: WorldPoint[], speed: number, pathId: number, start: WorldPoint) => void;
  /** 내 현재 경로의 Arrived. */
  onMyArrived?: (position: WorldPoint) => void;
  /** 서버 위치로 즉시 맞춘다 — FullState 채택(스폰 차이)과 정지 상태의 |Δ| > 1 unit 보정. */
  onMyCorrection?: (position: WorldPoint) => void;
  /** FullState 의 다른 주민 목록(통째 교체). */
  onActors?: (actors: MovementActor[]) => void;
  /**
   * 다른 주민의 그릴 위치 — FullState·Arrived 즉시, 스냅샷마다 100ms 뒤 보간 결과.
   * durationMs 는 이 위치까지 움직이는 애니메이션 길이(ms) — 보간 두 샘플의 틱 간격 기반이라 저주기
   * 스냅샷에서도 "움직이다 멈췄다"로 끊기지 않는다.
   */
  onRemotePosition?: (userId: string, position: RemotePosition, durationMs: number) => void;
};

export type MovementControllerOpts = MovementCallbacks & {
  /** 내 userId — 내 actor·경로를 다른 주민과 가른다. */
  me: string | null;
  /** 목적지 송신. 미연결이면 false. */
  send: (intent: MoveIntent) => boolean;
  /** 지금 서 있는 내 위치(월드). 정지 상태 보정 판단에만 쓴다. */
  position: () => WorldPoint;
  /** 내 고양이가 걷는 중인지. 걷는 동안 서버 위치는 지연(RTT × 속도)만큼 뒤처져 보이므로 보정하지 않는다. */
  walking: () => boolean;
  now?: () => number;
};

/** 2249 오버레이가 읽는 이동 상태. */
export type MovementState = {
  ready: boolean;
  denied: boolean;
  navRevision: number;
  commandSeq: number;
  /** 보낸 목적지에 2초 넘게 서버 응답이 없다 — 로컬로 걷는 중(폴백). */
  serverLag: boolean;
  /** 마지막 intent 송신 시각(now 기준) — PathAccepted·MoveRejected 로 응답을 받으면 null. */
  sentAt: number | null;
  /** 서버가 보는 내 actor. */
  self: MovementActor | null;
  /** 최근에 채택한 내 PathAccepted. */
  lastPath: { pathId: number; start: WorldPoint; waypoints: WorldPoint[] } | null;
  /** 최근 스냅샷의 내 위치. receivedAt 은 수신 벽시계(now 기준) — serverTick 은 서버 시계라 둘이 다르다. */
  lastSnapshot: (WorldPoint & { serverTick: number; state: string; receivedAt: number }) | null;
  /** 마지막으로 onMyCorrection 을 부른 시각(now 기준). */
  lastCorrectionAt: number | null;
  /** 마지막 MoveRejected 사유. */
  lastReject: string | null;
};

export type MovementController = {
  /** 탭 목적지(월드). 범위 밖·거절 뒤·ready 전이면 보내지 않고 false. */
  intend: (goal: WorldPoint) => boolean;
  /** STOMP 수신 본문(JSON 파싱 결과). `type` 으로 갈라 처리한다. */
  onMessage: (body: unknown) => void;
  /** 내 걷기가 끝났다 — 정지 상태 보정을 다시 판단한다. */
  settle: () => void;
  /** 채널 거절(ERROR·NOT_A_MEMBER) — 세션 동안 동기화를 끈다. */
  deny: () => void;
  state: () => MovementState;
  /** 상태가 바뀔 때마다 부른다(스냅샷마다 올 수 있다 — 무거운 일은 구독자가 줄인다). 해제 함수를 돌려준다. */
  subscribe: (listener: () => void) => () => void;
};

export function createMovementController(opts: MovementControllerOpts): MovementController {
  const now = opts.now ?? Date.now;
  const buffer = new SnapshotBuffer();
  const listeners = new Set<() => void>();
  let ready = false,
    denied = false,
    navRevision = 1,
    seq = 0,
    sentAt: number | null = null,
    deferred: WorldPoint | null = null,
    latestTick = 0,
    self: MovementActor | null = null,
    lastPath: MovementState['lastPath'] = null,
    lastSnapshot: MovementState['lastSnapshot'] = null,
    lastCorrectionAt: number | null = null,
    lastReject: string | null = null;
  const notify = () => listeners.forEach((listener) => listener());

  const send = (goal: WorldPoint) => {
    const intent = { commandSeq: seq + 1, navRevision, goalX: goal.x, goalY: goal.y };
    if (!opts.send(intent)) return false;
    seq = intent.commandSeq;
    sentAt = now();
    notify();
    return true;
  };

  // 응답 없는 intent 로 영영 막히지 않도록 "서버 대기 중"은 commandSeq 비교가 아니라 보낸 시각으로 판단한다 —
  // 속도 제한 등으로 응답(PathAccepted·MoveRejected)이 조용히 버려지면 SERVER_LAG_MS(= serverLag 와 같은 기준)를
  // 넘긴 순간 가드를 푼다. seq 자체는 되돌리지 않는다 — 다음 intent 는 seq+1 로 정상 채택된다.
  const awaitingServer = () => sentAt !== null && now() - sentAt <= SERVER_LAG_MS;
  // 정지 상태 보정 — 서버가 내 최신 명령까지 처리했고, 서버·로컬 둘 다 멈춰 있을 때만 비교한다.
  // 걷는 중에 비교하면 지연만큼 뒤처진 서버 위치로 뒤로 튄다(RTT 100ms × 11 unit/s ≈ 1 unit).
  const restCheck = (threshold: number) => {
    if (!self || self.state === 'MOVING' || awaitingServer() || opts.walking()) return;
    if (dist(opts.position(), self) <= threshold) return;
    lastCorrectionAt = now();
    opts.onMyCorrection?.({ x: self.x, y: self.y });
  };

  const fullState = (m: Record<string, unknown>) => {
    if (!Array.isArray(m.actors)) return;
    const actors = m.actors.map(actorOf).filter((a): a is MovementActor => !!a);
    navRevision = num(m.navRevision) ?? navRevision;
    const serverTick = num(m.serverTick) ?? 0;
    if (serverTick < latestTick) {
      // 서버·방 재시작 — 틱이 역행했다. 부분 리셋(resetIf)만으론 트랙에 남은 낡은 고틱 샘플이 새로 오는
      // 낮은 틱 샘플을 계속 역순으로 버린다(push 의 "지난 틱" 가드) — 주민 트랙을 통째로 비운다.
      buffer.clear();
      latestTick = serverTick;
    } else {
      latestTick = Math.max(latestTick, serverTick);
    }
    const mine = actors.find((a) => a.userId === opts.me) ?? null;
    const others = actors.filter((a) => a !== mine);
    buffer.retain(new Set(others.map((a) => a.userId)));
    // 서버 재시작으로 pathId 만 되돌아간 주민은(틱은 역행하지 않았을 수도 있다) 그 트랙의 판정만 푼다 —
    // clear() 와 달리 샘플·경로는 남겨 정상 FullState 에서 걷는 주민이 끊기지 않는다.
    for (const a of others) buffer.resetIf(a.userId, a.pathId);
    const wasReady = ready;
    // 내 actor 가 빠졌으면(강퇴 등) 목적지를 더 보내지 않는다 — 로컬 걷기로 폴백.
    ready = !!mine;
    if (mine) {
      // 내 pathId 도 같은 이유로 역행했으면 낡은 경로·스냅샷 표시만 비운다(판정은 바로 아래 self 교체가 맡는다).
      if (self && mine.pathId < self.pathId) {
        lastPath = null;
        lastSnapshot = null;
      }
      // 서버가 이미 처리한 번호는 다시 쓰지 않는다(재접속·다른 기기 세션 교체 방어).
      seq = Math.max(seq, mine.lastCommandSeq);
      self = mine;
    }
    opts.onActors?.(others);
    for (const a of others)
      opts.onRemotePosition?.(
        a.userId,
        { x: a.x, y: a.y, moving: a.state === 'MOVING' },
        REMOTE_TICK_MS,
      );
    if (ready && !wasReady && deferred) {
      // ready 전에 누른 마지막 목적지를 이제 보낸다 — 서버가 경로를 내면 PathAccepted 로 갈아탄다.
      const goal = deferred;
      deferred = null;
      send(goal);
    } else if (ready) restCheck(ADOPT_UNITS);
    notify();
  };

  const pathAccepted = (m: Record<string, unknown>) => {
    const userId = str(m.userId),
      pathId = num(m.pathId),
      start = point(m.start),
      waypoints = points(m.waypoints),
      speed = num(m.speed);
    if (!userId || pathId === null || !start || !waypoints) return;
    if (userId !== opts.me) {
      buffer.addPath(userId, pathId, [start, ...waypoints]);
      return;
    }
    // 옛 명령의 경로는 버린다 — 더 새 목적지를 이미 걷고 있다.
    if (!self || seq === 0 || num(m.commandSeq) !== seq || speed === null || speed <= 0) return;
    sentAt = null;
    self = {
      ...self,
      ...start,
      pathId,
      lastCommandSeq: seq,
      state: waypoints.length ? 'MOVING' : 'IDLE',
    };
    lastPath = { pathId, start, waypoints };
    opts.onMyPath?.(waypoints, speed, pathId, start);
    notify();
  };

  const moveRejected = (m: Record<string, unknown>) => {
    const at = point(m.position);
    if (!self || str(m.userId) !== opts.me || seq === 0 || num(m.commandSeq) !== seq) return;
    sentAt = null;
    lastReject = str(m.reason);
    self = { ...self, ...(at ?? {}), lastCommandSeq: seq };
    restCheck(CORRECTION_UNITS);
    notify();
  };

  const arrived = (m: Record<string, unknown>) => {
    const userId = str(m.userId),
      pathId = num(m.pathId),
      at = point(m.position);
    if (!userId || pathId === null || !at) return;
    latestTick = Math.max(latestTick, num(m.serverTick) ?? 0);
    if (userId !== opts.me) {
      if (buffer.arrive(userId, pathId, at))
        opts.onRemotePosition?.(userId, { ...at, moving: false }, REMOTE_TICK_MS);
      return;
    }
    // 더 새 목적지를 보내 두었어도, 응답 없이 SERVER_LAG_MS 를 넘겼으면(조용히 버려진 intent) 더는 막지 않는다.
    if (!self || pathId !== self.pathId || awaitingServer()) return;
    self = { ...self, ...at, state: 'IDLE' };
    opts.onMyArrived?.(at);
    notify();
  };

  const snapshot = (m: Record<string, unknown>) => {
    const tick = num(m.serverTick);
    if (tick === null || !Array.isArray(m.entities)) return;
    latestTick = Math.max(latestTick, tick);
    const remote: string[] = [];
    for (const raw of m.entities) {
      const e = actorOf(raw);
      if (!e) continue;
      if (e.userId === opts.me) {
        // 옛 경로의 늦은 좌표는 버린다(경로 메시지와 스냅샷은 순서가 뒤바뀔 수 있다).
        if (!self || e.pathId < self.pathId) continue;
        self = { ...e, lastCommandSeq: Math.max(self.lastCommandSeq, e.lastCommandSeq) };
        lastSnapshot = { x: e.x, y: e.y, serverTick: tick, state: e.state, receivedAt: now() };
        continue;
      }
      const segmentIndex = num((raw as Record<string, unknown>).segmentIndex) ?? 0;
      buffer.push(e.userId, {
        serverTick: tick,
        pathId: e.pathId,
        x: e.x,
        y: e.y,
        segmentIndex,
        moving: e.state === 'MOVING',
      });
      remote.push(e.userId);
    }
    const renderTick = latestTick - RENDER_DELAY_TICKS;
    for (const userId of remote) {
      const p = buffer.positionAtTimed(userId, renderTick);
      if (p) opts.onRemotePosition?.(userId, { x: p.x, y: p.y, moving: p.moving }, p.durationMs);
    }
    restCheck(CORRECTION_UNITS);
    notify();
  };

  return {
    intend: (goal) => {
      if (denied || !isInsideWorld(goal)) return false;
      const g = { x: round2(goal.x), y: round2(goal.y) };
      if (!ready) {
        deferred = g;
        return false;
      }
      return send(g);
    },
    onMessage: (body) => {
      const m = body as Record<string, unknown> | null;
      if (denied || !m || typeof m !== 'object') return;
      if (m.type === 'FullState') fullState(m);
      else if (m.type === 'PathAccepted') pathAccepted(m);
      else if (m.type === 'MoveRejected') moveRejected(m);
      else if (m.type === 'Arrived') arrived(m);
      else if (m.type === 'Snapshot') snapshot(m);
    },
    settle: () => restCheck(CORRECTION_UNITS),
    deny: () => {
      denied = true;
      ready = false;
      deferred = null;
      sentAt = null;
      notify();
    },
    state: () => ({
      ready,
      denied,
      navRevision,
      commandSeq: seq,
      serverLag: sentAt !== null && now() - sentAt > SERVER_LAG_MS,
      sentAt,
      self,
      lastPath,
      lastSnapshot,
      lastCorrectionAt,
      lastReject,
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
