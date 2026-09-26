import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { getBoard } from '@/services/api/notices';

export type BoardHomeStatus = 'unread' | 'new-comment' | null;
export type BoardNoticeSnapshot = Record<string, number>;

export function boardNoticeSnapshot(
  board: Awaited<ReturnType<typeof getBoard>>,
): BoardNoticeSnapshot {
  return Object.fromEntries(board.notices.items.map(({ id, commentCount }) => [id, commentCount]));
}

export function compareBoardNoticeSnapshots(
  current: BoardNoticeSnapshot,
  seen: BoardNoticeSnapshot,
): BoardHomeStatus {
  const ids = Object.keys(current);
  if (ids.some((id) => Object.prototype.hasOwnProperty.call(seen, id) && current[id] > seen[id]))
    return 'new-comment';
  if (ids.some((id) => !Object.prototype.hasOwnProperty.call(seen, id))) return 'unread';
  return null;
}

function parseSnapshot(value: string | null): BoardNoticeSnapshot | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((count) => Number.isInteger(count) && count >= 0)
    )
      return parsed as BoardNoticeSnapshot;
  } catch {
    // 손상된 로컬 기준점은 미확인 알림을 만들지 않도록 최초 동기화로 취급한다.
  }
  return null;
}

/** 게시판 목록의 로컬 확인 기준을 저장한다. 읽음 정본 API가 생기면 서버 계약으로 교체한다. */
export function useBoardHomeIndicator({
  active,
  ownerId,
  islandId,
  markRead,
}: {
  active: boolean;
  ownerId: string | null;
  islandId: string;
  markRead: boolean;
}): BoardHomeStatus {
  const [status, setStatus] = useState<BoardHomeStatus>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    if (!active || !ownerId || !islandId)
      return () => {
        cancelled = true;
      };

    const key = `gromo.board-indicator.v1:${ownerId}:${islandId}`;
    (async () => {
      try {
        const board = await getBoard();
        if (cancelled || board.island.id !== islandId) return;
        const current = boardNoticeSnapshot(board);
        const seen = parseSnapshot(await AsyncStorage.getItem(key));
        if (cancelled) return;
        if (markRead || !seen) {
          await AsyncStorage.setItem(key, JSON.stringify(current));
          if (!cancelled) setStatus(null);
          return;
        }
        setStatus(compareBoardNoticeSnapshots(current, seen));
      } catch {
        if (!cancelled) setStatus(null);
      }
    })().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [active, ownerId, islandId, markRead]);

  return status;
}
