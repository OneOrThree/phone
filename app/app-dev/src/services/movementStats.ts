/**
 * 이동 동기화 실기기 집계(GROMO-2250) — 개발 전용. 「이동 보기」가 켜진 동안만 기록한다(reset ~ stop).
 * 꺼져 있으면 각 훅은 enabled 검사 1회로 끝난다.
 * 정의는 서버 측 측정 스크립트(docs/prd/fishcat/island-movement/scripts/measure-movement.mjs)와 같다:
 *  - RTT: intent 송신 → 같은 commandSeq 의 내 PathAccepted. MoveRejected 는 대기만 지운다.
 *  - Snapshot 간격: 직전 Snapshot 에 MOVING entity 가 있었을 때만 잰다(정지 뒤 공백 제외). 연결이 열리면 끊는다.
 *  - FullState: 마지막 연결(onOpen) 이후 첫 FullState 까지.
 *  - 점프: 서버 위치로 맞출 때(place) 이미지 px 거리. 화면 px = 이미지 px × 그때 배율.
 */
type Body = {
  type?: unknown;
  userId?: unknown;
  commandSeq?: unknown;
  entities?: { state?: unknown }[];
} | null;
type Pt = { x: number; y: number };

/** 최근접 순위 백분위 — 정렬된 배열의 a[ceil(p·n) − 1]. 빈 배열은 null. */
export const pct = (sorted: number[], p: number): number | null =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
    : null;

const n = (v: number | null) => (v === null ? '—' : `${Math.round(v)}`);
const ms = (v: number | null) => (v === null ? '—' : `${n(v)}ms`);

export function createMovementStats(now: () => number = () => Date.now()) {
  let enabled = false,
    startedAt = 0,
    pending = new Map<number, number>(),
    rtts: number[] = [],
    snaps: number[] = [],
    lastSnap: { t: number; moving: boolean } | null = null,
    openedAt: number | null = null,
    openedReconnect = false,
    reconnects = 0,
    firstFullStateMs: number | null = null,
    lastReconnectToFullStateMs: number | null = null,
    maxImagePx = 0,
    maxScreenPx = 0,
    scaleAtMax = 1;

  const summary = () => {
    const r = [...rtts].sort((a, b) => a - b),
      s = [...snaps].sort((a, b) => a - b);
    return {
      rtt: { count: r.length, p50: pct(r, 0.5), p99: pct(r, 0.99), max: r.at(-1) ?? null },
      pending: pending.size,
      snapshot: {
        count: s.length,
        p50: pct(s, 0.5),
        p99: pct(s, 0.99),
        over100Ratio: s.length ? s.filter((v) => v >= 100).length / s.length : null,
      },
      jump: { maxImagePx, maxScreenPx, scaleAtMax },
      reconnects,
      firstFullStateMs,
      lastReconnectToFullStateMs,
      startedAt,
    };
  };

  return {
    reset() {
      enabled = true;
      startedAt = now();
      pending = new Map();
      rtts = [];
      snaps = [];
      lastSnap = null;
      openedAt = null;
      reconnects = 0;
      firstFullStateMs = lastReconnectToFullStateMs = null;
      maxImagePx = maxScreenPx = 0;
      scaleAtMax = 1;
    },
    stop() {
      enabled = false;
    },
    sent(commandSeq: number) {
      if (enabled) pending.set(commandSeq, now());
    },
    onMessage(raw: unknown, me: string | null) {
      if (!enabled) return;
      const b = raw as Body;
      const t = now();
      if (b?.type === 'Snapshot') {
        if (lastSnap?.moving) snaps.push(t - lastSnap.t);
        lastSnap = { t, moving: (b.entities ?? []).some((e) => e?.state === 'MOVING') };
      } else if (b?.type === 'FullState') {
        if (openedAt === null) return;
        if (openedReconnect) lastReconnectToFullStateMs = t - openedAt;
        else firstFullStateMs = t - openedAt;
        openedAt = null;
      } else if ((b?.type === 'PathAccepted' || b?.type === 'MoveRejected') && b.userId === me) {
        const seq = b.commandSeq as number;
        const sentAt = pending.get(seq);
        if (sentAt === undefined) return;
        pending.delete(seq);
        if (b.type === 'PathAccepted') rtts.push(t - sentAt);
      }
    },
    opened(reconnect: boolean) {
      if (!enabled) return;
      openedAt = now();
      openedReconnect = reconnect;
      lastSnap = null;
      if (reconnect) reconnects++;
    },
    jump(from: Pt, to: Pt, scale: number) {
      if (!enabled) return;
      const d = Math.hypot(to.x - from.x, to.y - from.y);
      if (d <= maxImagePx) return; // 0 도 여기서 걸러진다
      maxImagePx = d;
      maxScreenPx = d * scale;
      scaleAtMax = scale;
    },
    summary,
    /** 오버레이 셋째 줄·Metro 로그 2줄. 표본 0 이면 —. */
    format(at: number = now()) {
      const s = summary();
      const rtt = s.rtt.count
        ? `p50 ${n(s.rtt.p50)} · p99 ${n(s.rtt.p99)} · max ${n(s.rtt.max)}ms`
        : '—';
      const snap = s.snapshot.count
        ? `p50 ${n(s.snapshot.p50)} · p99 ${n(s.snapshot.p99)} · ≥100ms ${((s.snapshot.over100Ratio ?? 0) * 100).toFixed(1)}%`
        : '—';
      const jump = maxImagePx
        ? `max ${Math.round(maxScreenPx)}px(img ${Math.round(maxImagePx)} · z${scaleAtMax.toFixed(2)})`
        : '—';
      const secs = Math.max(0, Math.floor((at - startedAt) / 1000));
      return (
        `RTT ${s.rtt.count}건 ${rtt} (대기 ${s.pending}) | Snap ${s.snapshot.count}건 ${snap}\n` +
        `점프 ${jump} · 재접속 ${reconnects} · FullState ${ms(lastReconnectToFullStateMs)}(첫 ${ms(firstFullStateMs)}) · ${secs}s`
      );
    },
  };
}

export type MovementStats = ReturnType<typeof createMovementStats>;
export const movementStats = createMovementStats();
