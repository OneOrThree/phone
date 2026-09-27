import { useEffect, useSyncExternalStore } from 'react';
import { getBlockedUsers, type BlockedUser } from '@/services/api/safety';
import { sessionGeneration, subscribeSession } from '@/services/api/session';

let generation = sessionGeneration();
let ids: ReadonlySet<string> = new Set();
let loaded = false;
let flight: Promise<BlockedUser[]> | null = null;
let mutationRevision = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

const resetForSession = () => {
  generation = sessionGeneration();
  ids = new Set();
  loaded = false;
  flight = null;
  mutationRevision = 0;
  emit();
};

// 로그인·로그아웃으로 주체가 바뀌면 이전 계정의 차단 목록을 절대 재사용하지 않는다.
subscribeSession(() => {
  if (generation !== sessionGeneration()) resetForSession();
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => ids;

export function replaceBlockedUsers(users: BlockedUser[]): void {
  ids = new Set(users.map((user) => user.id));
  loaded = true;
  emit();
}

export function markUserBlocked(userId: string): void {
  if (ids.has(userId)) return;
  ids = new Set(ids).add(userId);
  mutationRevision += 1;
  emit();
}

export function markUserUnblocked(userId: string): void {
  if (!ids.has(userId)) return;
  const next = new Set(ids);
  next.delete(userId);
  ids = next;
  mutationRevision += 1;
  emit();
}

export function isUserBlocked(userId: string | null | undefined): boolean {
  return !!userId && ids.has(userId);
}

/** 같은 세션에서는 한 번만 적재하고, 강제 갱신은 refreshBlockedUsers를 쓴다. */
export function loadBlockedUsers(): Promise<BlockedUser[]> {
  if (loaded) return Promise.resolve([]);
  if (flight) return flight;
  return refreshBlockedUsers();
}

export function refreshBlockedUsers(): Promise<BlockedUser[]> {
  const expectedGeneration = sessionGeneration();
  const expectedRevision = mutationRevision;
  const request = getBlockedUsers().then((users) => {
    // GET을 시작한 뒤 차단/해제가 성공했다면 이 응답은 그 변경 전 snapshot일 수 있다.
    if (expectedGeneration === sessionGeneration() && expectedRevision === mutationRevision) {
      replaceBlockedUsers(users);
    }
    return users;
  });
  flight = request;
  request.then(
    () => {
      if (flight === request) {
        flight = null;
        // 변경 전 snapshot을 버린 경우 기존 차단 목록까지 복구하도록 최신 목록을 다시 읽는다.
        if (expectedGeneration === sessionGeneration() && expectedRevision !== mutationRevision) {
          refreshBlockedUsers().catch(() => {});
        }
      }
    },
    () => {
      if (flight === request) flight = null;
    },
  );
  return request;
}

export function useBlockedUserIds(active = true): ReadonlySet<string> {
  const blockedIds = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (active) loadBlockedUsers().catch(() => {});
  }, [active]);
  return blockedIds;
}
