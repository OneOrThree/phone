import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { getBlockedUsers, type BlockedUser } from '@/services/api/safety';
import { sessionGeneration, subscribeSession } from '@/services/api/session';

let generation = sessionGeneration();
let ids: ReadonlySet<string> = new Set();
let loaded = false;
let lastValidatedAt = 0;
let loadError: unknown = null;
let flight: Promise<BlockedUser[]> | null = null;
let mutationRevision = 0;
let refreshSequence = 0;
let storeRevision = 0;
const listeners = new Set<() => void>();
const BLOCKED_USERS_TTL_MS = 30_000;

const emit = () => {
  storeRevision += 1;
  listeners.forEach((listener) => listener());
};

const resetForSession = () => {
  generation = sessionGeneration();
  ids = new Set();
  loaded = false;
  lastValidatedAt = 0;
  loadError = null;
  flight = null;
  mutationRevision = 0;
  refreshSequence = 0;
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

const snapshot = () => storeRevision;

export function replaceBlockedUsers(users: BlockedUser[]): void {
  ids = new Set(users.map((user) => user.id));
  loaded = true;
  lastValidatedAt = Date.now();
  loadError = null;
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

/** 최근 목록은 재사용하되 오래된 cache는 같은 세션에서도 다시 검증한다. */
export function loadBlockedUsers(): Promise<BlockedUser[]> {
  if (loaded && Date.now() - lastValidatedAt < BLOCKED_USERS_TTL_MS) return Promise.resolve([]);
  if (flight) return flight;
  return refreshBlockedUsers();
}

/** 화면 재진입·포그라운드 복귀의 재검증은 여러 소비자가 동시에 요청해도 한 GET으로 합친다. */
export function revalidateBlockedUsers(): Promise<BlockedUser[]> {
  if (flight) return flight;
  return refreshBlockedUsers();
}

export function refreshBlockedUsers(): Promise<BlockedUser[]> {
  const expectedGeneration = sessionGeneration();
  const expectedRevision = mutationRevision;
  const requestSequence = ++refreshSequence;
  loadError = null;
  if (!loaded) emit();
  const request = getBlockedUsers().then((users) => {
    // GET을 시작한 뒤 차단/해제가 성공했다면 이 응답은 그 변경 전 snapshot일 수 있다.
    if (
      expectedGeneration === sessionGeneration() &&
      expectedRevision === mutationRevision &&
      requestSequence === refreshSequence
    ) {
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
    (error) => {
      if (flight === request) {
        flight = null;
        if (expectedGeneration === sessionGeneration()) {
          loadError = error;
          emit();
        }
      }
    },
  );
  return request;
}

export type BlockedUsersLoadStatus = 'loading' | 'ready' | 'error';

export function useBlockedUsers(active = true): {
  ids: ReadonlySet<string>;
  status: BlockedUsersLoadStatus;
  error: unknown;
  retry: () => Promise<BlockedUser[]>;
} {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const hasActivated = useRef(false);
  useEffect(() => {
    if (!active) return;
    const request = hasActivated.current ? revalidateBlockedUsers() : loadBlockedUsers();
    hasActivated.current = true;
    request.catch(() => {});
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') revalidateBlockedUsers().catch(() => {});
    });
    return () => subscription.remove();
  }, [active]);
  return {
    ids,
    status: loaded ? 'ready' : loadError ? 'error' : 'loading',
    error: loadError,
    retry: refreshBlockedUsers,
  };
}

export function useBlockedUserIds(active = true): ReadonlySet<string> {
  return useBlockedUsers(active).ids;
}
