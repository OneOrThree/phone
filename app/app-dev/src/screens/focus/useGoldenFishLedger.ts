import { useEffect, useRef } from 'react';
import { getLedger, type LedgerEntry } from '@/services/api/townHall';
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

  coverageStartMs(): number | null {
    return this.snapshots[0]?.atMs ?? null;
  }

  observe(atMs: number, members: GoldenFishMember[]) {
    if (!Number.isFinite(atMs)) return;
    const latest = this.snapshots[this.snapshots.length - 1];
    // 정확한 realtime 전이 뒤에 늦은 렌더/스냅숏 시각이 들어와 과거 상태를 덮지 않게 한다.
    if (latest && atMs < latest.atMs) return;
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
    const snapshot = this.membersAt(atMs);
    if (snapshot === null) return;
    const members = new Map(snapshot.map((member) => [member.userId, member]));
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

  membersAt(atMs: number): GoldenFishMember[] | null {
    if (!Number.isFinite(atMs)) return null;
    for (let index = this.snapshots.length - 1; index >= 0; index--) {
      if (this.snapshots[index].atMs <= atMs) return this.snapshots[index].members;
    }
    return null;
  }
}

type GoldenFishSignalSource = 'ledger' | 'realtime';

type PendingGoldenFishSignal = {
  source: GoldenFishSignalSource;
  atMs: number;
  islandId: string;
  sessionId: string;
};

const GOLDEN_SIGNAL_MATCH_WINDOW_MS = 10 * 60_000;

/**
 * realtime의 추첨 분과 원장의 실제 기록 시각은 분 경계를 사이에 둘 수 있다. 두 신호를 분 단위로
 * 잘라 비교하지 않고, 같은 세션에 도착한 두 소스의 발생 순서를 한 번씩 짝지어 같은 당첨으로 접는다.
 */
export class GoldenFishOccurrenceTracker {
  private seenEventIds = new Set<string>();
  private pending: PendingGoldenFishSignal[] = [];

  accept(event: GoldenFishEvent, sessionId: string): boolean {
    if (this.seenEventIds.has(event.eventId)) return false;
    this.seenEventIds.add(event.eventId);
    const source: GoldenFishSignalSource = event.eventId.startsWith('ledger:')
      ? 'ledger'
      : 'realtime';
    const atMs = Date.parse(event.drawnAt);
    if (!Number.isFinite(atMs)) return false;
    this.pending = this.pending.filter(
      (candidate) => Math.abs(atMs - candidate.atMs) <= GOLDEN_SIGNAL_MATCH_WINDOW_MS,
    );
    const match = this.pending.findIndex((candidate) => {
      if (
        candidate.source === source ||
        candidate.islandId !== event.islandId ||
        candidate.sessionId !== sessionId
      )
        return false;
      const realtimeAt = source === 'realtime' ? atMs : candidate.atMs;
      const ledgerAt = source === 'ledger' ? atMs : candidate.atMs;
      return ledgerAt >= realtimeAt && ledgerAt - realtimeAt <= GOLDEN_SIGNAL_MATCH_WINDOW_MS;
    });
    if (match >= 0) {
      this.pending.splice(match, 1);
      return false;
    }
    this.pending.push({ source, atMs, islandId: event.islandId, sessionId });
    return true;
  }
}

const MAX_LEDGER_PAGES = 100;

async function ledgerItemsSince(islandId: string, month: string, afterMs: number) {
  const items: LedgerEntry[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_LEDGER_PAGES; pageNumber++) {
    const page = await getLedger(islandId, { month, direction: 'earn', cursor });
    items.push(...page.items);
    if (
      !page.nextCursor ||
      page.items.length === 0 ||
      page.items.some((entry) => Date.parse(entry.createdAt) < afterMs)
    ) {
      return items;
    }
    cursor = page.nextCursor;
  }
  throw new Error('golden fish ledger pagination exceeded');
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
  membersAt: (atMs: number) => GoldenFishMember[] | null;
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
        const items = (
          await Promise.all(
            months.map((month) => ledgerItemsSince(islandId, month, scope.current.afterMs)),
          )
        ).flat();
        if (disposed || accountGeneration !== sessionGeneration()) return;
        const afterMs = scope.current.afterMs;
        const fresh = items
          .filter(
            (entry) =>
              entry.reason === 'golden_fish' &&
              Date.parse(entry.createdAt) >= afterMs &&
              (sessionEligibleUntil == null ||
                Date.parse(entry.createdAt) <= sessionEligibleUntil) &&
              !seen.current.has(entry.id),
          )
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        let safeThrough = requestedAt;
        for (const entry of fresh) {
          const entryAt = Date.parse(entry.createdAt);
          const participants = membersAtRef.current(entryAt);
          if (participants === null) {
            safeThrough = Math.min(safeThrough, entryAt);
            continue;
          }
          seen.current.add(entry.id);
          // 원장 자체가 서버의 2명 이상 추첨 결과다. 재접속 전 구간은 이 단말에서 확실히
          // 복원할 수 있는 자기 세션만 싣고, 다른 주민을 현재 스냅숏으로 추측하지 않는다.
          if (participants.length === 0) continue;
          callbackRef.current({
            eventId: `ledger:${entry.id}`,
            islandId,
            drawnAt: entry.createdAt,
            reward: entry.amount,
            sharePerMember:
              participants.length >= 2 ? Math.floor(entry.amount / participants.length) : 0,
            members: participants,
          });
        }
        scope.current.afterMs = Math.max(scope.current.afterMs, safeThrough);
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
