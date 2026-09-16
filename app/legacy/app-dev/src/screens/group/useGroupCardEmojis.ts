import { useCallback, useEffect, useMemo, useState } from 'react';
import { logGroupCardIconSaveResult } from '@/services/analyticsEvents';
import {
  DEFAULT_GROUP_CARD_EMOJI,
  reconcileGroupCardEmojiBucket,
  retryPendingGroupCardEmojis,
  type GroupCardEmoji,
  type GroupCardEmojiBucket,
} from './groupCardEmojiStore';

interface Params {
  userId: string | null;
  groupIds: readonly string[];
  reloadToken?: number;
}

interface EmojiState {
  identity: string | null;
  userId: string | null;
  emojis: GroupCardEmojiBucket;
}

/**
 * 서버의 성공한 전체 목록에 로컬 아이콘을 투영한다.
 * identity가 다른 늦은 완료는 버려 계정 전환 직후 이전 계정 아이콘이 노출되지 않게 한다.
 */
export function useGroupCardEmojis({ userId, groupIds, reloadToken = 0 }: Params) {
  const groupKey = groupIds.join('\u0000');
  const identity = `${userId ?? 'guest'}:${groupKey}:${reloadToken}`;
  const [state, setState] = useState<EmojiState>({ identity: null, userId: null, emojis: {} });

  useEffect(() => {
    let current = true;
    if (!userId) {
      setState({ identity, userId: null, emojis: {} });
      return () => {
        current = false;
      };
    }

    const idsForRead = groupKey ? groupKey.split('\u0000') : [];
    // pending 쓰기가 모두 끝난 뒤 디스크 bucket을 다시 읽는다. 병렬 실행하면 첫/둘째 retry
    // 사이의 중간 상태를 hydrate하고 성공한 pending도 큐에서 사라져 화면에서 누락될 수 있다.
    retryPendingGroupCardEmojis(
      userId,
      idsForRead,
      () => current,
      (surface, result) => {
        if (current) logGroupCardIconSaveResult({ surface, result });
      },
    )
      .catch(() => ({}))
      .then(async (pending) => ({
        stored: await reconcileGroupCardEmojiBucket(userId, idsForRead).catch(() => null),
        pending,
      }))
      .then(({ pending, stored }) => {
        if (!current) return;
        setState((previous) => {
          const fallback =
            stored === null && previous.userId === userId
              ? Object.fromEntries(
                  idsForRead.flatMap((groupId) =>
                    previous.emojis[groupId] === undefined
                      ? []
                      : [[groupId, previous.emojis[groupId]]],
                  ),
                )
              : {};
          return {
            identity,
            userId,
            emojis: { ...(stored ?? fallback), ...pending },
          };
        });
      });
    return () => {
      current = false;
    };
  }, [groupKey, identity, userId]);

  const hydrated = state.identity === identity;
  const emojiFor = useCallback(
    (groupId: string): GroupCardEmoji =>
      hydrated ? (state.emojis[groupId] ?? DEFAULT_GROUP_CARD_EMOJI) : DEFAULT_GROUP_CARD_EMOJI,
    [hydrated, state.emojis],
  );

  return useMemo(() => ({ hydrated, emojiFor }), [emojiFor, hydrated]);
}
