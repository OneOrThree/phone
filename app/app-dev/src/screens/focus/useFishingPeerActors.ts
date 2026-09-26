import { useCallback, useEffect, useRef, useState } from 'react';
import type { Color } from '@/services/model';
import type { IslandPresenceTransition, LiveFocusMember } from '@/services/islandRealtime';
import { LANDING, PEER_SPOTS } from '@/screens/focus/FishingIsland';
import type { Point } from '@/utils/world-grid';
import type { Spot } from '@/screens/focus/FishingIsland';

export type FishingPeer = {
  userId: string;
  sessionId: string;
  name: string;
  color: Color;
  subject: string | null;
  seconds: number;
  status?: 'active' | 'paused';
};

export type FishingPeerActor = FishingPeer & {
  key: string;
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

const actorKey = (userId: string, sessionId: string) => `${userId}:${sessionId}`;
const fromLive = (member: LiveFocusMember, seconds: number): FishingPeer => ({
  userId: member.userId,
  sessionId: member.sessionId,
  name: member.name ?? '주민',
  color: (['black', 'ginger', 'cream', 'gray', 'white', 'calico'].includes(member.catColor ?? '')
    ? member.catColor
    : 'gray') as Color,
  subject: member.subject,
  seconds,
  status: member.status,
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
}: {
  members: FishingPeer[];
  ready: boolean;
  reduce: boolean;
  realtime?: boolean;
  snapshotVersion?: number;
}) {
  const [actors, setActors] = useState<FishingPeerActor[]>([]);
  const [revision, setRevision] = useState(0);
  const slots = useRef(new Map<string, number>());
  const transitions = useRef<IslandPresenceTransition[]>([]);
  const appliedSnapshotVersion = useRef<number | null>(null);
  const membersRef = useRef(members);
  membersRef.current = members;
  const snapshotKey = members
    .map((member) => `${member.userId}:${member.sessionId}:${member.status}`)
    .join('|');
  const alloc = useCallback((key: string) => {
    const existing = slots.current.get(key);
    if (existing != null) return existing;
    const used = new Set(slots.current.values());
    const slot = PEER_SPOTS.findIndex((_, n) => !used.has(n));
    const picked = slot < 0 ? 0 : slot;
    slots.current.set(key, picked);
    return picked;
  }, []);

  const onTransition = useCallback((transition: IslandPresenceTransition) => {
    transitions.current.push(transition);
    setRevision((value) => value + 1);
  }, []);

  // A newly ready view is a snapshot (initial entry or reconnect), so it never animates.
  useEffect(() => {
    if (!ready) {
      appliedSnapshotVersion.current = null;
      return;
    }
    if (realtime && appliedSnapshotVersion.current === snapshotVersion) return;
    appliedSnapshotVersion.current = snapshotVersion;
    const next = membersRef.current.map((member) => {
      const key = actorKey(member.userId, member.sessionId),
        slot = alloc(key),
        spot = PEER_SPOTS[slot];
      return {
        ...member,
        key,
        slot,
        spot,
        position: member.status === 'paused' ? LANDING : spot,
        phase: member.status === 'paused' ? ('paused' as const) : ('fishing' as const),
        visible: member.status !== 'paused',
        generation: 0,
      };
    });
    setActors(next);
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
    setActors((current) => {
      let next = [...current];
      for (const transition of pending) {
        if (transition.kind !== 'focus') continue;
        const before = transition.previous,
          after = transition.current,
          sessionId = after?.sessionId ?? before?.sessionId;
        if (!sessionId) continue;
        const key = actorKey(transition.userId, sessionId),
          found = next.findIndex((actor) => actor.key === key),
          existing = found >= 0 ? next[found] : null;
        if (after?.status === 'active') {
          const peer = fromLive(after, after.activeSeconds),
            slot = existing?.slot ?? alloc(key),
            spot = PEER_SPOTS[slot];
          const actor: FishingPeerActor = {
            ...peer,
            key,
            slot,
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
          else next.push(actor);
        } else if (after?.status === 'paused' && before?.status === 'active' && existing) {
          next[found] = {
            ...existing,
            phase: 'leaving-pause',
            generation: existing.generation + 1,
          };
        } else if (!after && existing) {
          if (!existing.visible) {
            slots.current.delete(key);
            next.splice(found, 1);
          } else {
            next[found] = { ...existing, phase: 'finishing', generation: existing.generation + 1 };
          }
        }
      }
      return next;
    });
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
  }, [reduce]);

  return { actors, onTransition, entered, cast, leftForPause, stretched, leftForComplete };
}
