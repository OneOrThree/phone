import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getBoard, listNotices } from '@/services/api/notices';

export type BoardHomeStatus = 'unread' | 'new-comment' | null;
export type BoardNoticeSnapshot = Record<string, number>;

export async function boardNoticeSnapshot(
  board: Awaited<ReturnType<typeof getBoard>>,
): Promise<BoardNoticeSnapshot> {
  const notices = [...board.notices.items];
  const cursors = new Set<string>();
  let cursor = board.notices.nextCursor;
  while (cursor !== null) {
    if (cursors.has(cursor)) throw new Error('게시판 공지 페이지를 이어서 불러오지 못했어요.');
    cursors.add(cursor);
    const page = await listNotices(board.island.id, cursor);
    notices.push(...page.items);
    cursor = page.nextCursor;
  }
  return Object.fromEntries(notices.map(({ id, commentCount }) => [id, commentCount]));
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
  const [statusRecord, setStatusRecord] = useState<{
    scopeKey: string;
    status: BoardHomeStatus;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const scopeKey = `${ownerId ?? ''}:${islandId}`;

  useEffect(() => {
    if (!active || markRead) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') setRefreshKey((key) => key + 1);
    });
    return () => subscription.remove();
  }, [active, markRead]);

  useEffect(() => {
    let cancelled = false;
    if (!active || !ownerId || !islandId) {
      setStatusRecord(null);
      return () => {
        cancelled = true;
      };
    }

    const key = `gromo.board-indicator.v1:${ownerId}:${islandId}`;
    (async () => {
      try {
        const board = await getBoard();
        if (cancelled || board.island.id !== islandId) return;
        const current = await boardNoticeSnapshot(board);
        const seen = parseSnapshot(await AsyncStorage.getItem(key));
        if (cancelled) return;
        if (markRead || !seen) {
          await AsyncStorage.setItem(key, JSON.stringify(current));
          if (!cancelled) setStatusRecord({ scopeKey, status: null });
          return;
        }
        setStatusRecord({ scopeKey, status: compareBoardNoticeSnapshots(current, seen) });
      } catch {
        // 실패 시 같은 사용자·섬에서 마지막으로 확인한 상태를 유지해 배지를 숨기지 않는다.
      }
    })().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [active, ownerId, islandId, markRead, refreshKey, scopeKey]);

  return active && statusRecord?.scopeKey === scopeKey ? statusRecord.status : null;
}
