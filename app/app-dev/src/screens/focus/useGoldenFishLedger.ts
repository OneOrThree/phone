import { useEffect, useRef } from 'react';
import { getLedger } from '@/services/api/townHall';
import { sessionGeneration } from '@/services/api/session';
import { dayKey } from '@/services/model';
import type {
  GoldenFishEvent,
  GoldenFishMember,
  IslandPresenceTransition,
} from '@/services/islandRealtime';

const DEFAULT_POLL_MS = 4_000;

type GoldenLedgerScope = {
  sessionId: string | null;
  afterMs: number;
  active: boolean;
  activated: boolean;
};

const memberKey = (member: GoldenFishMember) => `${member.userId}:${member.sessionId}`;

export class GoldenFishMemberTimeline {
  private snapshots: { atMs: number; members: GoldenFishMember[] }[] = [];

  reset() {
    this.snapshots = [];
  }

  observe(atMs: number, members: GoldenFishMember[]) {
    if (!Number.isFinite(atMs)) return;
    const unique = members
      .filter(
        (member, index, all) =>
          all.findIndex((candidate) => memberKey(candidate) === memberKey(member)) === index,
      )
      .sort((a, b) => memberKey(a).localeCompare(memberKey(b)));
    const signature = unique.map(memberKey).join('|');
    const previous = [...this.snapshots].reverse().find((snapshot) => snapshot.atMs <= atMs);
    if (previous?.members.map(memberKey).join('|') === signature) return;
    this.snapshots.push({ atMs, members: unique });
    this.snapshots.sort((a, b) => a.atMs - b.atMs);
    if (this.snapshots.length > 200) this.snapshots.splice(0, this.snapshots.length - 200);
  }

  applyTransition(atMs: number, transition: IslandPresenceTransition) {
    if (transition.kind !== 'focus') return;
    const members = new Map(this.membersAt(atMs).map((member) => [member.userId, member]));
    if (members.size === 0) return;
    members.delete(transition.userId);
    if (transition.current?.status === 'active') {
      members.set(transition.userId, {
        userId: transition.current.userId,
        sessionId: transition.current.sessionId,
      });
    }
    this.observe(atMs, [...members.values()]);
  }

  membersAt(atMs: number): GoldenFishMember[] {
    if (!Number.isFinite(atMs)) return [];
    for (let index = this.snapshots.length - 1; index >= 0; index--) {
      if (this.snapshots[index].atMs <= atMs) return this.snapshots[index].members;
    }
    return [];
  }
}

/**
 * 운영 realtime이 아직 focus.golden을 방송하지 않으므로, 기존 공동 가계부의 golden_fish 행을
 * 클라이언트 신호로 사용한다. 서버 보상 계산은 재현하지 않고 이미 적립된 원장 행만 감지한다.
 */
export function useGoldenFishLedger({
  active,
  islandId,
  sessionId,
  sessionStartedAt,
  sessionEligibleUntil,
  membersAt,
  onGoldenFish,
  clockOffsetMs = 0,
  pollMs = DEFAULT_POLL_MS,
}: {
  active: boolean;
  islandId: string | null;
  sessionId: string | null;
  sessionStartedAt: number | null;
  sessionEligibleUntil?: number | null;
  membersAt: (atMs: number) => GoldenFishMember[];
  onGoldenFish: (event: GoldenFishEvent) => void;
  clockOffsetMs?: number;
  pollMs?: number;
}) {
  const membersAtRef = useRef(membersAt);
  membersAtRef.current = membersAt;
  const clockOffsetRef = useRef(clockOffsetMs);
  clockOffsetRef.current = clockOffsetMs;
  const callbackRef = useRef(onGoldenFish);
  callbackRef.current = onGoldenFish;
  const seen = useRef(new Set<string>());
  const scope = useRef<GoldenLedgerScope>({
    sessionId: null,
    afterMs: 0,
    active: false,
    activated: false,
  });

  useEffect(() => {
    const current = scope.current;
    if (current.sessionId !== sessionId) {
      seen.current.clear();
      scope.current = {
        sessionId,
        afterMs: sessionStartedAt ?? Date.now() + clockOffsetRef.current,
        active: false,
        activated: false,
      };
    }
    if (!active || !islandId || !sessionId) {
      scope.current.active = false;
      return;
    }
    if (!scope.current.active) {
      if (scope.current.activated) {
        scope.current.afterMs = Date.now() + clockOffsetRef.current;
      }
      scope.current.active = true;
      scope.current.activated = true;
    }

    const accountGeneration = sessionGeneration();
    let disposed = false;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      const requestedAt = Date.now() + clockOffsetRef.current;
      try {
        const afterMonth = dayKey(scope.current.afterMs).slice(0, 7);
        const requestedMonth = dayKey(requestedAt).slice(0, 7);
        const months =
          afterMonth === requestedMonth ? [requestedMonth] : [afterMonth, requestedMonth];
        const pages = await Promise.all(
          months.map((month) => getLedger(islandId, { month, direction: 'earn' })),
        );
        if (disposed || accountGeneration !== sessionGeneration()) return;
        const afterMs = scope.current.afterMs;
        const fresh = pages
          .flatMap((page) => page.items)
          .filter(
            (entry) =>
              entry.reason === 'golden_fish' &&
              Date.parse(entry.createdAt) >= afterMs &&
              (sessionEligibleUntil == null ||
                Date.parse(entry.createdAt) <= sessionEligibleUntil) &&
              !seen.current.has(entry.id),
          )
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        for (const entry of fresh) {
          seen.current.add(entry.id);
          const participants = membersAtRef.current(Date.parse(entry.createdAt));
          if (participants.length < 2) continue;
          callbackRef.current({
            eventId: `ledger:${entry.id}`,
            islandId,
            drawnAt: entry.createdAt,
            reward: entry.amount,
            sharePerMember: Math.floor(entry.amount / participants.length),
            members: participants,
          });
        }
        scope.current.afterMs = Math.max(scope.current.afterMs, requestedAt);
      } catch {
        // 일시 실패는 다음 poll에서 다시 읽는다. 영상 신호 때문에 집중 흐름을 막지 않는다.
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), pollMs);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [active, islandId, pollMs, sessionEligibleUntil, sessionId, sessionStartedAt]);
}
