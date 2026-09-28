import { useEffect, useRef } from 'react';
import { getLedger, type LedgerEntry } from '@/services/api/townHall';
import { sessionGeneration } from '@/services/api/session';
import { dayKey } from '@/services/model';
import type { GoldenFishEvent, GoldenFishMember } from '@/services/islandRealtime';

// realtime 누락 복구용 폴백이다. 정상 연결 중 사용자마다 원장을 자주 스캔하지 않는다.
const DEFAULT_POLL_MS = 60_000;

type GoldenLedgerScope = {
  sessionId: string | null;
  afterMs: number;
  active: boolean;
  activated: boolean;
};

type GoldenFishSignalSource = 'ledger' | 'realtime';

type PendingGoldenFishSignal = {
  source: GoldenFishSignalSource;
  atMs: number;
  islandId: string;
  sessionId: string;
  members: GoldenFishMember[];
};

export type GoldenFishOccurrenceDecision = {
  display: boolean;
  additionalMembers: GoldenFishMember[];
};

const GOLDEN_SIGNAL_MATCH_WINDOW_MS = 10 * 60_000;

/**
 * realtime의 추첨 분과 원장의 실제 기록 시각은 분 경계를 사이에 둘 수 있다. 두 신호를 분 단위로
 * 잘라 비교하지 않고, 같은 세션에 도착한 두 소스의 발생 순서를 한 번씩 짝지어 같은 당첨으로 접는다.
 */
export class GoldenFishOccurrenceTracker {
  private seenEventIds = new Set<string>();
  private pending: PendingGoldenFishSignal[] = [];

  accept(event: GoldenFishEvent, sessionId: string): GoldenFishOccurrenceDecision {
    if (this.seenEventIds.has(event.eventId)) return { display: false, additionalMembers: [] };
    this.seenEventIds.add(event.eventId);
    const source: GoldenFishSignalSource = event.eventId.startsWith('ledger:')
      ? 'ledger'
      : 'realtime';
    const atMs = Date.parse(event.drawnAt);
    if (!Number.isFinite(atMs)) return { display: false, additionalMembers: [] };
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
      const [matched] = this.pending.splice(match, 1);
      const known = new Set(
        matched.members.map((member) => `${member.userId}:${member.sessionId}`),
      );
      return {
        display: false,
        // 원장 신호가 먼저였으면 뒤따른 realtime의 정확한 참여자를 더미에 보강한다.
        additionalMembers:
          source === 'realtime'
            ? event.members.filter((member) => !known.has(`${member.userId}:${member.sessionId}`))
            : [],
      };
    }
    this.pending.push({
      source,
      atMs,
      islandId: event.islandId,
      sessionId,
      members: event.members,
    });
    return { display: true, additionalMembers: [] };
  }
}

const MAX_LEDGER_PAGES = 100;
const LEDGER_LOOKBACK_MS = 60_000;

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
  recoveryVersion = 0,
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
  recoveryVersion?: number;
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
          // 원장 createdAt은 보상 저장 시각이지 서버의 후보 스냅숏 시각이 아니다. 따라서
          // 이 단말에서 ACTIVE 구간을 검증할 수 있는 자기 세션만 복구하고 다른 주민은 추측하지 않는다.
          const participant = participants.find((member) => member.sessionId === sessionId);
          if (!participant) continue;
          callbackRef.current({
            eventId: `ledger:${entry.id}`,
            islandId,
            drawnAt: entry.createdAt,
            reward: entry.amount,
            sharePerMember: 0,
            members: [participant],
          });
        }
        // GET과 아직 커밋되지 않은 원장 INSERT가 겹쳐도 다음 조회가 행을 다시 포함하게 한다.
        // seen id가 겹치는 조회의 중복 화면 사건을 막는다.
        scope.current.afterMs = Math.max(scope.current.afterMs, safeThrough - LEDGER_LOOKBACK_MS);
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
  }, [
    active,
    islandId,
    pollMs,
    recoveryVersion,
    sessionEligibleUntil,
    sessionId,
    sessionStartedAt,
  ]);
}
