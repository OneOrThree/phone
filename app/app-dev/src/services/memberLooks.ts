import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { request } from './api/client';
import { getSession, sessionGeneration, subscribeSession } from './api/session';
import { isUserBlocked, useBlockedUserIds } from './blockedUsers';
import { parseLook } from './memberAppearance';
import { MemberLookCache, type CachedMemberLook, type MemberLookBatch } from './memberLookCache';

export const memberLooks = new MemberLookCache(async (ids) => {
  const response = await request<MemberLookBatch>(
    `/me/member-appearances?userIds=${encodeURIComponent(ids.join(','))}`,
  );
  if (!Array.isArray(response.members) || !Array.isArray(response.hiddenUserIds))
    throw new Error('Invalid member looks');
  return {
    ...response,
    members: response.members.map((row) => {
      const appearance = parseLook(row.appearance);
      if (!appearance || !Number.isSafeInteger(appearance.version) || appearance.version! < 0)
        throw new Error('Invalid appearance version');
      return { ...row, appearance };
    }),
  };
});

let generation = sessionGeneration();
let previousBlocked: ReadonlySet<string> | undefined;
subscribeSession(() => {
  if (generation === sessionGeneration()) return;
  generation = sessionGeneration();
  previousBlocked = undefined;
  memberLooks.clear();
});

/** 접속 때 강제로 복구하고, 평소에는 캐시가 없거나 만료된 사용자만 읽는다. */
export function ensureMemberLooks(ids: readonly string[], force = false) {
  if (!getSession()) return Promise.resolve();
  return memberLooks.ensure(
    ids.filter((id) => !isUserBlocked(id)),
    force,
  );
}

/** 그림을 표시하는 화면만 구독한다. 차단·계정 변경·복귀는 같은 표시 캐시에 반영한다. */
export function useMemberLooks(
  ids: readonly string[],
  active = true,
): Record<string, CachedMemberLook> {
  const blocked = useBlockedUserIds(false);
  const key = [...new Set(ids)].sort().join(',');
  const gen = sessionGeneration();
  const revision = useSyncExternalStore(
    memberLooks.subscribe,
    memberLooks.snapshot,
    memberLooks.snapshot,
  );
  useEffect(() => {
    const previous = previousBlocked;
    previousBlocked = blocked;
    // 초기 마운트와 같은 내용의 재검증은 다른 화면이 채운 캐시를 무효화하지 않는다.
    if (
      !previous ||
      (previous.size === blocked.size && [...previous].every((id) => blocked.has(id)))
    )
      return;
    memberLooks.clear();
  }, [blocked]);
  useEffect(() => {
    if (!active || !key) return;
    const wanted = key.split(',');
    void ensureMemberLooks(wanted);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void ensureMemberLooks(wanted, true);
    });
    const timer = setInterval(() => {
      // 응답 지연으로 캐시 만료가 다음 틱을 넘겨도 매 주기 색상을 확인한다.
      void ensureMemberLooks(wanted, true);
    }, 30_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [key, active, gen, blocked]);
  return useMemo(() => {
    const result: Record<string, CachedMemberLook> = {};
    if (active)
      for (const id of key.split(',')) {
        const value = memberLooks.get(id);
        if (blocked.has(id)) result[id] = { catColor: null, appearance: null, hidden: true };
        else if (value) result[id] = value;
      }
    return result;
  }, [key, active, revision, blocked]);
}
