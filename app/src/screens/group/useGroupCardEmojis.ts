import { useCallback, useEffect, useMemo, useState } from 'react';
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
  emojis: GroupCardEmojiBucket;
}

/**
 * 서버의 성공한 전체 목록에 로컬 아이콘을 투영한다.
 * identity가 다른 늦은 완료는 버려 계정 전환 직후 이전 계정 아이콘이 노출되지 않게 한다.
 */
export function useGroupCardEmojis({ userId, groupIds, reloadToken = 0 }: Params) {
  const groupKey = groupIds.join('\u0000');
  const identity = `${userId ?? 'guest'}:${groupKey}:${reloadToken}`;
  const [state, setState] = useState<EmojiState>({ identity: null, emojis: {} });

  useEffect(() => {
    let current = true;
    if (!userId) {
      setState({ identity, emojis: {} });
      return () => {
        current = false;
      };
    }

    const idsForRead = groupKey ? groupKey.split('\u0000') : [];
    Promise.all([
      retryPendingGroupCardEmojis(userId, idsForRead),
      reconcileGroupCardEmojiBucket(userId, idsForRead).catch(() => ({})),
    ]).then(([pending, stored]) => {
      if (current) setState({ identity, emojis: { ...stored, ...pending } });
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
