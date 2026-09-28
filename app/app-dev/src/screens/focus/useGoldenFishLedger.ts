import { useEffect, useRef } from 'react';
import { getLedger } from '@/services/api/townHall';
import { sessionGeneration } from '@/services/api/session';
import { dayKey } from '@/services/model';
import type { GoldenFishEvent, GoldenFishMember } from '@/services/islandRealtime';

const DEFAULT_POLL_MS = 60_000;
const LOOKBACK_MS = 60_000;
const MAX_LEDGER_PAGES = 100;

const monthsBetween = (fromMs: number, toMs: number) => {
  const first = dayKey(fromMs).slice(0, 7);
  const last = dayKey(toMs).slice(0, 7);
  return first === last ? [last] : [first, last];
};

async function ledgerItemsSince(islandId: string, month: string, afterMs: number) {
  const items = [] as Awaited<ReturnType<typeof getLedger>>['items'];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_LEDGER_PAGES; pageNumber++) {
    const page = await getLedger(islandId, { month, direction: 'earn', cursor });
    items.push(...page.items);
    if (
      !page.nextCursor ||
      page.items.length === 0 ||
      page.items.some((entry) => Date.parse(entry.createdAt) < afterMs)
    )
      return items;
    cursor = page.nextCursor;
  }
  throw new Error('golden fish ledger pagination exceeded');
}

/**
 * realtime 전달 어댑터가 없는 운영 버전에서도 새로 적립된 golden_fish 원장 행을
 * 클라이언트 신호로 사용한다. 마운트 이전 행은 읽지 않아 재실행 재생을 막고, 행을
 * 발견한 시점의 realtime ACTIVE 스냅숏에 현재 세션이 포함된 경우만 표시한다.
 * 보상·확률은 재계산하지 않고 이미 적립된 원장의 총액만 전달한다.
 */
export function useGoldenFishLedger({
  active,
  islandId,
  sessionId,
  sinceMs,
  members,
  onGoldenFish,
  clockOffsetMs = 0,
  pollMs = DEFAULT_POLL_MS,
}: {
  active: boolean;
  islandId: string | null;
  sessionId: string | null;
  sinceMs: number;
  members: () => GoldenFishMember[];
  onGoldenFish: (event: GoldenFishEvent) => void;
  clockOffsetMs?: number;
  pollMs?: number;
}) {
  const membersRef = useRef(members);
  membersRef.current = members;
  const callbackRef = useRef(onGoldenFish);
  callbackRef.current = onGoldenFish;
  const offsetRef = useRef(clockOffsetMs);
  offsetRef.current = clockOffsetMs;

  useEffect(() => {
    if (!active || !islandId || !sessionId) return;
    const generation = sessionGeneration();
    let cursorMs = sinceMs;
    let disposed = false;
    let reading = false;
    const seen = new Set<string>();

    const read = async () => {
      if (reading) return;
      reading = true;
      const requestedAt = Date.now() + offsetRef.current;
      try {
        const items = (
          await Promise.all(
            monthsBetween(cursorMs - LOOKBACK_MS, requestedAt).map((month) =>
              ledgerItemsSince(islandId, month, cursorMs - LOOKBACK_MS),
            ),
          )
        ).flat();
        if (disposed || generation !== sessionGeneration()) return;
        const entries = items
          .filter(
            (entry) =>
              entry.reason === 'golden_fish' &&
              Date.parse(entry.createdAt) >= sinceMs &&
              Date.parse(entry.createdAt) >= cursorMs - LOOKBACK_MS &&
              !seen.has(entry.id),
          )
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        for (const entry of entries) {
          seen.add(entry.id);
          const participants = membersRef.current();
          if (
            participants.length < 2 ||
            !participants.some((member) => member.sessionId === sessionId)
          )
            continue;
          callbackRef.current({
            eventId: `ledger:${entry.id}`,
            islandId,
            drawnAt: entry.createdAt,
            reward: entry.amount,
            sharePerMember: 0,
            members: participants,
          });
        }
        cursorMs = requestedAt;
      } catch {
        // 일시 실패는 다음 poll에서 다시 읽고 집중 흐름은 막지 않는다.
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
  }, [active, islandId, pollMs, sessionId, sinceMs]);
}
