import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
import type { Color } from '@/services/model';
import type { IslandPresenceTransition, LiveFocusMember } from '@/services/islandRealtime';
import {
  castSpot,
  DEFAULT_CATCH_PLACEMENT,
  DEFAULT_SPOT,
  fishingCatchPlacement,
  fishingGrid,
  fishingPeerCatchVisible,
  LANDING,
  nearGram,
  nearRaft,
  occupied,
  PEER_SPOTS,
  underDefaultCatch,
} from '@/screens/focus/FishingIsland';
import { onLand, type Point } from '@/utils/world-grid';
import type { Spot } from '@/screens/focus/FishingIsland';

export type FishingPeer = {
  userId: string;
  sessionId: string;
  name: string;
  color: Color;
  subject: string | null;
  seconds: number;
  status?: 'active' | 'paused';
  /** 서버가 준 자리(GROMO-2478, 지도 %). 없거나 못 쓰면 슬롯 배정. */
  seat?: Point | null;
};

export type FishingPeerActor = FishingPeer & {
  key: string;
  /** PEER_SPOTS 번호. 서버 자리에 앉았으면 -1. */
  slot: number;
  spot: Spot;
  position: Point;
  phase:
    | 'entering'
    | 'casting'
    | 'fishing'
    | 'leaving-pause'
    | 'paused'
    | 'finishing'
    | 'leaving-complete';
  visible: boolean;
  generation: number;
};

/** 자리 예약과 별개로, 낚싯줄·찌는 실제 낚시 중인 주민에게만 표시한다. */
export const fishingSpotsForActors = (actors: FishingPeerActor[]) =>
  actors.filter((actor) => actor.visible && actor.phase === 'fishing').map((actor) => actor.spot);

const actorKey = (userId: string, sessionId: string) => `${userId}:${sessionId}`;
// 내 자리에 막힌 자리인지 — 내 고양이 곁(SEAT_GAP)이거나, 내가 DEFAULT_SPOT 에 앉아 고정 물고기 더미가 덮는 곳.
// 다른 자리에서는 화면이 내 물고기 더미를 주민을 피해 정하므로(fishingCatchPlacement) 고양이 곁만 본다.
const blockedByMine = (p: Point, mine?: Point) =>
  !!mine &&
  (occupied(p, [mine]) ||
    (mine.x === DEFAULT_SPOT.x && mine.y === DEFAULT_SPOT.y && underDefaultCatch(p)));
// 예비 자리: 내 자리·서버 자리가 PEER_SPOTS 칸을 여럿 막아 정원 안 주민이 앉을 칸이 모자랄 때만 쓴다.
// 네 이웃도 땅인 칸 가운데 축음기·뗏목을 피한 곳을 섬 가운데에 가까운 순서로(기기마다 같은 순서).
const SPARE_SPOTS: Point[] = (() => {
  const { cols, rows, w, h, cells } = fishingGrid,
    land = (c: number) => cells[c] === '1',
    spots: Point[] = [];
  for (let c = 0; c < cells.length; c++) {
    const col = c % cols,
      row = Math.floor(c / cols),
      p = { x: ((col + 0.5) * w) / cols, y: ((row + 0.5) * h) / rows };
    if (
      col &&
      row &&
      col < cols - 1 &&
      row < rows - 1 &&
      [c, c - 1, c + 1, c - cols, c + cols].every(land) &&
      !nearGram(p) &&
      !nearRaft(p)
    )
      spots.push(p);
  }
  const center = (p: Point) => Math.hypot(p.x - 50, p.y - 50);
  return spots.sort((a, b) => center(a) - center(b));
})();
// 서버 자리·예비 자리(castSpot)는 PEER_SPOTS 처럼 미리 정한 물고기 자리가 없다 — 다른 주민·내 고양이를 덮지
// 않게 같은 회피 계산(fishingCatchPlacement)으로 함께 정한다. 앞에서 정한 물고기 자리는 뒤 계산의 장애물이 된다.
// PEER_SPOTS 칸은 미리 정한 자리 그대로다(내 물고기 자리가 그것을 기준으로 피한다).
const withCatchPlacements = (actors: FishingPeerActor[], mine?: Point) => {
  const spots = actors.map((actor) => actor.spot),
    // 화면은 내가 DEFAULT_SPOT 에 앉으면 고정 물고기 더미를 쓴다(CurrentScreens 2330) — 주민 더미가 그것도 피하게
    me = mine
      ? [
          mine.x === DEFAULT_SPOT.x && mine.y === DEFAULT_SPOT.y
            ? { ...castSpot(mine), catchPlacement: DEFAULT_CATCH_PLACEMENT }
            : castSpot(mine),
        ]
      : [];
  actors.forEach((actor, index) => {
    if (Object.prototype.hasOwnProperty.call(actor.spot, 'catchPlacement')) return;
    const others = [...spots.filter((_, other) => other !== index), ...me];
    spots[index] = { ...actor.spot, catchPlacement: fishingCatchPlacement(actor.spot, others) };
  });
  return new Map(actors.map((actor, index) => [actor.key, spots[index]]));
};
const fromLive = (member: LiveFocusMember, seconds: number): FishingPeer => ({
  userId: member.userId,
  sessionId: member.sessionId,
  name: member.name ?? t('focusFlow.common.resident'),
  color: (['black', 'ginger', 'cream', 'gray', 'white', 'calico'].includes(member.catColor ?? '')
    ? member.catColor
    : 'gray') as Color,
  subject: member.subject,
  seconds,
  status: member.status,
  seat: member.seat,
});

/**
 * Peer seat and motion orchestration. Ready snapshots are applied immediately; only the
 * verified transition callback starts entrance/exit motion. Paused sessions keep their slot.
 */
export function useFishingPeerActors({
  members,
  ready,
  reduce,
  realtime = true,
  snapshotVersion = 0,
  snapshotTransitions = [],
  mine,
}: {
  members: FishingPeer[];
  ready: boolean;
  reduce: boolean;
  realtime?: boolean;
  snapshotVersion?: number;
  snapshotTransitions?: IslandPresenceTransition[];
  /** 내 자리 — 슬롯·서버 자리가 이 곁(SEAT_GAP)이거나 내 고정 물고기 더미 아래면 쓰지 않는다. 방문 관전은 없음. */
  mine?: Point;
}) {
  const [actors, setActors] = useState<FishingPeerActor[]>([]);
  const [revision, setRevision] = useState(0);
  // actor key → 예약한 자리(PEER_SPOTS 칸 또는 서버 자리)
  const slots = useRef(new Map<string, Spot>());
  const mineRef = useRef(mine);
  mineRef.current = mine;
  // 서버 seat 가 내 자리에만 막혀 다른 칸에 앉힌 주민 — 내 자리가 바뀌거나 풀리면 seat 로 되돌린다
  const displacedByMine = useRef(new Set<string>());
  const transitions = useRef<IslandPresenceTransition[]>([]);
  const appliedSnapshotVersion = useRef<number | null>(null);
  const membersRef = useRef(members);
  membersRef.current = members;
  const snapshotTransitionsRef = useRef(snapshotTransitions);
  snapshotTransitionsRef.current = snapshotTransitions;
  const snapshotKey = members
    .map((member) => `${member.userId}:${member.sessionId}:${member.status}`)
    .join('|');
  // 서버 자리가 땅 위이고 내 자리·예약된 자리와 겹치지 않으면 그 자리, 아니면 reuse(같은 주민의 이전 세션 자리),
  // 그것도 없으면 겹치지 않는 첫 빈 칸 → 예비 자리. PEER_SPOTS 끼리는 SEAT_GAP 보다 멀어 예약된 칸 자신만 걸린다.
  // 예약은 정원(PEER_SPOTS 15칸)만큼만 — 만석이면 퇴장이 자리를 반납할 때까지 보류한다.
  // reuse 는 곧 반납할 이전 예약을 넘겨받는 것이라 정원에 세지 않고 충돌 검사에서도 뺀다.
  // seatOnly 면 서버 자리를 그대로 쓸 수 있을 때만 예약하고, 아니면 아무것도 바꾸지 않고 null(스냅숏 1단계).
  // alloc 은 slots·displacedByMine 를 바꾸고 setActors updater(스냅숏·내 자리 변경·전이 effect) 안에서 불린다 — StrictMode
  // 가 updater 를 두 번 돌려도 같은 결과가 나오게 updater 는 멱등이어야 한다(예약을 지운 뒤 alloc). 비멱등 분기 금지.
  const alloc = useCallback((key: string, seat?: Point | null, reuse?: Spot, seatOnly = false) => {
    const existing = slots.current.get(key);
    if (existing) return existing;
    if (!reuse && slots.current.size >= PEER_SPOTS.length) return null;
    const others = [...slots.current.values()].filter((spot) => spot !== reuse),
      free = (p: Point) => !occupied(p, others) && !blockedByMine(p, mineRef.current),
      spare = () => {
        const p = SPARE_SPOTS.find(free);
        return p && castSpot(p);
      },
      usable = seat && onLand(fishingGrid, seat) && !occupied(seat, others) ? seat : null,
      seatFree = usable && free(usable) ? usable : null;
    if (seatOnly && !seatFree) return null;
    if (usable && !seatFree) displacedByMine.current.add(key);
    else displacedByMine.current.delete(key);
    const spot = seatFree ? castSpot(seatFree) : (reuse ?? PEER_SPOTS.find(free) ?? spare());
    if (!spot) return null;
    slots.current.set(key, spot);
    return spot;
  }, []);

  // 내 자리가 바뀌거나 풀리면 그 때문에 밀려난 주민만 다시 앉힌다. seat 가 여전히 막히면 지금 칸(reuse)에
  // 그대로 두고, 다른 주민의 칸은 건드리지 않는다. 걷는 중이면 새 자리로 길을 다시 잡는다(FishingPeerActorView).
  const mineX = mine?.x,
    mineY = mine?.y;
  useEffect(() => {
    const mineNow = mineRef.current;
    if (!displacedByMine.current.size && !mineNow) return;
    setActors((current) => {
      let changed = false;
      const next = current.map((actor) => {
        // 내 자리가 새로 생기거나 옮겨 이미 앉은(예약한) 주민과 겹치면 그 주민을 비켜 앉힌다 — seat 주민은
        // displacedByMine 에 들어가 내 자리가 풀리면 돌아온다(내가 걷는 사이 같은 자리 사건이 온 경우)
        const blocked = blockedByMine(actor.spot, mineNow);
        if (!blocked && !displacedByMine.current.has(actor.key)) return actor;
        slots.current.delete(actor.key);
        const spot = alloc(actor.key, actor.seat, blocked ? undefined : actor.spot) ?? actor.spot;
        slots.current.set(actor.key, spot);
        if (spot === actor.spot) return actor;
        changed = true;
        const atSpot = actor.position.x === actor.spot.x && actor.position.y === actor.spot.y;
        return {
          ...actor,
          slot: PEER_SPOTS.indexOf(spot),
          spot,
          position: atSpot ? spot : actor.position,
        };
      });
      return changed ? next : current;
    });
  }, [mineX, mineY, alloc]);

  const onTransition = useCallback((transition: IslandPresenceTransition) => {
    transitions.current.push(transition);
    setRevision((value) => value + 1);
  }, []);

  // A newly ready view is a snapshot (initial entry or reconnect), so it never animates.
  useEffect(() => {
    if (!ready) {
      appliedSnapshotVersion.current = null;
      transitions.current.length = 0;
      slots.current.clear();
      displacedByMine.current.clear();
      setActors([]);
      return;
    }
    if (realtime && appliedSnapshotVersion.current === snapshotVersion) return;
    appliedSnapshotVersion.current = snapshotVersion;
    setActors((current) => {
      const snapshotMembers = new Map(membersRef.current.map((member) => [member.userId, member]));
      const peerIds = new Set([...snapshotMembers.keys(), ...current.map((actor) => actor.userId)]);
      // 스냅숏 조회 중 도착해 replay된 이벤트는 최종 members에 이미 반영돼 있다.
      // 해당 전이만 역적용해 스냅숏 기준 actor를 만든 뒤, 아래 transition effect가 모션을 시작한다.
      for (const transition of [...snapshotTransitionsRef.current].reverse()) {
        if (transition.kind !== 'focus' || !peerIds.has(transition.userId)) continue;
        if (transition.previous)
          snapshotMembers.set(
            transition.userId,
            fromLive(transition.previous, transition.previous.activeSeconds),
          );
        else snapshotMembers.delete(transition.userId);
      }
      const incomingKeys = new Set(
        [...snapshotMembers.values()].map((member) => actorKey(member.userId, member.sessionId)),
      );
      for (const key of slots.current.keys()) {
        if (!incomingKeys.has(key)) slots.current.delete(key);
      }
      // 재검증: 들어오는 주민 전원의 예약을 풀고 처음 연 화면과 같은 순서로 다시 앉힌다 — 앞서 대체 칸을 받은 주민이
      // (좌표 없음·종료 연출 중인 주민에 막힘) 뒤에 온 주민의 서버 seat 를 계속 쥐지 않게. 스냅숏은 즉시 적용하는
      // 정본이라 자리가 바뀌어도 된다. 이전 칸은 2단계에서 아직 비어 있으면 그대로 돌려준다.
      const incoming = [...snapshotMembers.values()],
        kept = new Map<string, Spot>();
      for (const member of incoming) {
        const key = actorKey(member.userId, member.sessionId),
          spot = slots.current.get(key);
        if (!spot) continue;
        slots.current.delete(key);
        kept.set(key, spot);
      }
      // 1단계: 쓸 수 있고 비어 있는 서버 seat 를 전부 먼저 예약한다 — 좌표 없는·내 자리에 막힌 주민의 대체 칸이
      // 뒤 주민의 정상 seat 를 가로채 기기마다 다른 자리에 그리지 않게. 2단계는 남은 주민을 스냅숏 순서대로 앉힌다.
      for (const member of incoming)
        alloc(actorKey(member.userId, member.sessionId), member.seat, undefined, true);
      return incoming.flatMap((member) => {
        const key = actorKey(member.userId, member.sessionId),
          // seat 가 여전히 막히면 이전 칸이 아직 비어 있을 때 그대로 둔다(불필요한 이동 없이)
          previous = kept.get(key),
          reuse =
            previous &&
            !occupied(previous, [...slots.current.values()]) &&
            !blockedByMine(previous, mineRef.current)
              ? previous
              : undefined,
          spot = alloc(key, member.seat, reuse);
        if (!spot) return [];
        return [
          {
            ...member,
            key,
            slot: PEER_SPOTS.indexOf(spot),
            spot,
            position: member.status === 'paused' ? LANDING : spot,
            phase: member.status === 'paused' ? ('paused' as const) : ('fishing' as const),
            visible: member.status !== 'paused',
            generation: 0,
          },
        ];
      });
    });
  }, [ready, snapshotKey, alloc, realtime, snapshotVersion]);

  // Keep labels and fish count current without changing an actor's stable seat or motion.
  useEffect(() => {
    if (!ready) return;
    const byKey = new Map(
      membersRef.current.map((member) => [actorKey(member.userId, member.sessionId), member]),
    );
    setActors((current) => {
      let changed = false;
      const next = current.map((actor) => {
        const member = byKey.get(actor.key);
        if (
          !member ||
          (actor.name === member.name &&
            actor.color === member.color &&
            actor.subject === member.subject &&
            actor.seconds === member.seconds)
        )
          return actor;
        changed = true;
        return {
          ...actor,
          ...member,
          key: actor.key,
          slot: actor.slot,
          spot: actor.spot,
          position: actor.position,
          phase: actor.phase,
          visible: actor.visible,
          generation: actor.generation,
        };
      });
      return changed ? next : current;
    });
  }, [members, ready]);

  useEffect(() => {
    if (!transitions.current.length) return;
    const pending = transitions.current.splice(0);
    const hasCompletion = pending.some(
      (transition) => transition.kind === 'focus' && transition.current === null,
    );
    setActors((current) => {
      let next = [...current];
      const deferred: IslandPresenceTransition[] = [];
      for (const transition of pending) {
        if (transition.kind !== 'focus') continue;
        const before = transition.previous,
          after = transition.current,
          sessionId = after?.sessionId ?? before?.sessionId;
        if (!sessionId) continue;
        if (!after) {
          // 자리를 받기 전에 완료되면 앞서 보류한 active 입장을 함께 취소한다.
          const matchesPendingEntry = (candidate: IslandPresenceTransition) =>
            candidate.kind === 'focus' &&
            candidate.userId === transition.userId &&
            candidate.current?.sessionId === sessionId;
          for (let index = deferred.length - 1; index >= 0; index--)
            if (matchesPendingEntry(deferred[index])) deferred.splice(index, 1);
          transitions.current = transitions.current.filter(
            (candidate) => !matchesPendingEntry(candidate),
          );
        }
        if (
          !membersRef.current.some((member) => member.userId === transition.userId) &&
          !next.some((actor) => actor.userId === transition.userId)
        )
          continue;
        const key = actorKey(transition.userId, sessionId),
          found = next.findIndex((actor) => actor.key === key),
          previousKey = before?.sessionId ? actorKey(transition.userId, before.sessionId) : null,
          previousFound = previousKey
            ? next.findIndex((actor) => actor.key === previousKey)
            : after
              ? next.findIndex(
                  (actor) =>
                    actor.userId === transition.userId &&
                    (actor.phase === 'finishing' || actor.phase === 'leaving-complete'),
                )
              : -1,
          existing = found >= 0 ? next[found] : null,
          replaced = !existing && previousFound >= 0 ? next[previousFound] : null;
        if (after?.status === 'active') {
          const peer = fromLive(after, after.activeSeconds),
            spot = existing?.spot ?? alloc(key, after.seat, replaced?.spot);
          if (!spot) {
            deferred.push(transition);
            continue;
          }
          if (replaced) slots.current.delete(replaced.key);
          const actor: FishingPeerActor = {
            ...peer,
            key,
            slot: PEER_SPOTS.indexOf(spot),
            spot,
            position: existing?.position ?? LANDING,
            phase:
              existing?.phase === 'paused' || existing?.phase === 'leaving-pause'
                ? 'entering'
                : existing
                  ? existing.phase
                  : 'entering',
            visible: true,
            generation: (existing?.generation ?? 0) + 1,
          };
          if (found >= 0) next[found] = actor;
          else if (previousFound >= 0) next[previousFound] = actor;
          else next.push(actor);
        } else if (after?.status === 'paused') {
          if (before?.status === 'active' && existing) {
            next[found] = {
              ...existing,
              phase: 'leaving-pause',
              generation: existing.generation + 1,
            };
          } else if (!existing) {
            const peer = fromLive(after, after.activeSeconds),
              spot = alloc(key, after.seat, replaced?.spot);
            if (!spot) {
              deferred.push(transition);
              continue;
            }
            if (replaced) slots.current.delete(replaced.key);
            const actor: FishingPeerActor = {
              ...peer,
              key,
              slot: PEER_SPOTS.indexOf(spot),
              spot,
              position: LANDING,
              phase: 'paused',
              visible: false,
              generation: (replaced?.generation ?? 0) + 1,
            };
            if (previousFound >= 0) next[previousFound] = actor;
            else next.push(actor);
          }
        } else if (!after && existing) {
          if (!existing.visible) {
            slots.current.delete(key);
            next.splice(found, 1);
          } else {
            next[found] = { ...existing, phase: 'finishing', generation: existing.generation + 1 };
          }
        }
      }
      if (deferred.length) transitions.current.unshift(...deferred);
      return next;
    });
    // 숨겨진 paused actor의 완료처럼 이 회차에서 슬롯을 즉시 반납했다면
    // 같은 회차에 다시 보류된 입장을 빈 슬롯으로 재처리한다.
    if (hasCompletion) setRevision((value) => value + 1);
  }, [revision, alloc]);

  const entered = useCallback((key: string, generation: number) => {
    setActors((current) =>
      current.map((actor) =>
        actor.key === key && actor.generation === generation && actor.phase === 'entering'
          ? { ...actor, position: actor.spot, phase: 'casting', generation: actor.generation + 1 }
          : actor,
      ),
    );
  }, []);
  const cast = useCallback((key: string, generation: number) => {
    setActors((current) =>
      current.map((actor) =>
        actor.key === key && actor.generation === generation && actor.phase === 'casting'
          ? { ...actor, phase: 'fishing', generation: actor.generation + 1 }
          : actor,
      ),
    );
  }, []);
  const leftForPause = useCallback((key: string, generation: number) => {
    setActors((current) =>
      current.map((actor) =>
        actor.key === key && actor.generation === generation && actor.phase === 'leaving-pause'
          ? {
              ...actor,
              position: LANDING,
              phase: 'paused',
              visible: false,
              generation: actor.generation + 1,
            }
          : actor,
      ),
    );
  }, []);
  const stretched = useCallback((key: string, generation: number) => {
    setActors((current) =>
      current.map((actor) =>
        actor.key === key && actor.generation === generation && actor.phase === 'finishing'
          ? { ...actor, phase: 'leaving-complete', generation: actor.generation + 1 }
          : actor,
      ),
    );
  }, []);
  const leftForComplete = useCallback((key: string, generation: number) => {
    setActors((current) => {
      const removed = current.find((actor) => actor.key === key && actor.generation === generation);
      if (removed) slots.current.delete(key);
      return current.filter((actor) => actor.key !== key || actor.generation !== generation);
    });
    // 만석 중 보류된 입장은 퇴장 모션이 자리를 실제로 반납한 뒤 다시 배정한다.
    setRevision((value) => value + 1);
  }, []);

  // Reduce Motion bypasses route legs and one-shot motions while preserving the same final state.
  useEffect(() => {
    if (!reduce) return;
    setActors((current) =>
      current.flatMap((actor) => {
        if (actor.phase === 'entering')
          return [
            { ...actor, position: actor.spot, phase: 'fishing', generation: actor.generation + 1 },
          ];
        if (actor.phase === 'casting')
          return [{ ...actor, phase: 'fishing', generation: actor.generation + 1 }];
        if (actor.phase === 'leaving-pause')
          return [
            {
              ...actor,
              position: LANDING,
              phase: 'paused',
              visible: false,
              generation: actor.generation + 1,
            },
          ];
        if (actor.phase === 'finishing' || actor.phase === 'leaving-complete') {
          slots.current.delete(actor.key);
          return [];
        }
        return [actor];
      }),
    );
    // 즉시 퇴장으로 반환된 슬롯이 있으면 만석 때문에 보류된 입장을 다시 처리한다.
    setRevision((value) => value + 1);
  }, [reduce]);

  // 물고기 자리는 배치(누가 어디)가 바뀔 때만 다시 잰다 — 초마다 바뀌는 집중 시간 갱신은 무시한다
  const layout = actors.map((actor) => `${actor.key}@${actor.spot.x},${actor.spot.y}`).join('|');
  const placed = useMemo(
    () => withCatchPlacements(actors, mine),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 배치·내 자리가 같으면 결과도 같다
    [layout, mineX, mineY],
  );
  const shown = useMemo(
    () =>
      actors.map((actor) => {
        const spot = placed.get(actor.key);
        return spot && spot !== actor.spot ? { ...actor, spot } : actor;
      }),
    [actors, placed],
  );
  return { actors: shown, onTransition, entered, cast, leftForPause, stretched, leftForComplete };
}
