import { useEffect, useRef } from 'react';
import { getLedger } from '@/services/api/townHall';
import { sessionGeneration } from '@/services/api/session';
import { dayKey } from '@/services/model';
import type { GoldenFishEvent, GoldenFishMember } from '@/services/islandRealtime';

const DEFAULT_POLL_MS = 4_000;

type GoldenLedgerScope = {
  sessionId: string | null;
  afterMs: number;
  active: boolean;
  activated: boolean;
};

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
  members,
  onGoldenFish,
  pollMs = DEFAULT_POLL_MS,
}: {
  active: boolean;
  islandId: string | null;
  sessionId: string | null;
  sessionStartedAt: number | null;
  sessionEligibleUntil?: number | null;
  members: GoldenFishMember[];
  onGoldenFish: (event: GoldenFishEvent) => void;
  pollMs?: number;
}) {
  const membersRef = useRef(members);
  membersRef.current = members;
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
        afterMs: sessionStartedAt ?? Date.now(),
        active: false,
        activated: false,
      };
    }
    if (!active || !islandId || !sessionId) {
      scope.current.active = false;
      return;
    }
    if (!scope.current.active) {
      if (scope.current.activated) scope.current.afterMs = Date.now();
      scope.current.active = true;
      scope.current.activated = true;
    }

    const accountGeneration = sessionGeneration();
    let disposed = false;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      const requestedAt = Date.now();
      try {
        const page = await getLedger(islandId, {
          month: dayKey(requestedAt).slice(0, 7),
          direction: 'earn',
        });
        if (disposed || accountGeneration !== sessionGeneration()) return;
        const participants = membersRef.current.filter(
          (member, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.userId === member.userId && candidate.sessionId === member.sessionId,
            ) === index,
        );
        if (participants.length < 2) {
          // 휴식·종료 뒤에는 참여자 구성이 뒤늦게 채워져도 그 사이 다른 주민의 당첨을 내 것으로 만들지 않는다.
          if (sessionEligibleUntil != null) {
            scope.current.afterMs = Math.max(scope.current.afterMs, requestedAt);
          }
          return;
        }
        const afterMs = scope.current.afterMs;
        const fresh = page.items
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
