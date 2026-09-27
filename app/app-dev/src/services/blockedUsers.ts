import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { getBlockedUsers, type BlockedUser } from '@/services/api/safety';
import { sessionGeneration, subscribeSession } from '@/services/api/session';

let generation = sessionGeneration();
let ids: ReadonlySet<string> = new Set();
let users: ReadonlyArray<BlockedUser> = [];
let loaded = false;
let lastValidatedAt = 0;
let loadError: unknown = null;
let flight: Promise<BlockedUser[]> | null = null;
let revalidationTail: Promise<BlockedUser[]> | null = null;
let synchronousRevalidation: {
  generation: number;
  request: Promise<BlockedUser[]>;
} | null = null;
let validating = false;
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
  users = [];
  loaded = false;
  lastValidatedAt = 0;
  loadError = null;
  flight = null;
  revalidationTail = null;
  synchronousRevalidation = null;
  validating = false;
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

export function replaceBlockedUsers(nextUsers: BlockedUser[]): void {
  ids = new Set(nextUsers.map((user) => user.id));
  // 호출자가 이후 배열을 수정해도 store snapshot은 바뀌지 않게 복사한다.
  users = nextUsers.map((user) => ({ ...user }));
  loaded = true;
  lastValidatedAt = Date.now();
  loadError = null;
  emit();
}

export function markUserBlocked(userId: string): void {
  // 서버가 mutation 성공을 확인했다면 로컬 membership이 같아도 진행 중 GET은
  // mutation 이전 snapshot일 수 있다. revision을 먼저 올려 그 응답을 폐기한다.
  mutationRevision += 1;
  if (ids.has(userId)) return;
  ids = new Set(ids).add(userId);
  emit();
}

export function markUserUnblocked(userId: string): void {
  mutationRevision += 1;
  if (!ids.has(userId)) return;
  const next = new Set(ids);
  next.delete(userId);
  ids = next;
  users = users.filter((user) => user.id !== userId);
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
  const expectedGeneration = sessionGeneration();
  // 한 JS event에서 여러 활성 소비자가 만든 동일 경계만 합친다. 이후 event에서 생긴
  // 화면 진입·포그라운드 경계는 진행 중 재검증 뒤에 새 GET으로 직렬화한다.
  if (synchronousRevalidation?.generation === expectedGeneration) {
    return synchronousRevalidation.request;
  }
  const previousRequests = [...new Set([revalidationTail, flight].filter(Boolean))] as Promise<
    BlockedUser[]
  >[];
  const request = (async () => {
    await Promise.all(previousRequests.map((previous) => previous.catch(() => [])));
    // 예약한 계정이 바뀌었으면 이전 계정의 후속 GET을 새 세션에서 실행하지 않는다.
    if (expectedGeneration !== sessionGeneration()) return [];
    return refreshBlockedUsers();
  })();
  revalidationTail = request;
  synchronousRevalidation = { generation: expectedGeneration, request };
  Promise.resolve().then(() => {
    if (synchronousRevalidation?.request === request) synchronousRevalidation = null;
  });
  request.then(
    () => {
      if (revalidationTail === request) revalidationTail = null;
    },
    () => {
      if (revalidationTail === request) revalidationTail = null;
    },
  );
  return request;
}

export function refreshBlockedUsers(): Promise<BlockedUser[]> {
  const expectedGeneration = sessionGeneration();
  const expectedRevision = mutationRevision;
  const requestSequence = ++refreshSequence;
  loadError = null;
  validating = true;
  emit();
  const request = getBlockedUsers().then((nextUsers) => {
    // GET을 시작한 뒤 차단/해제가 성공했다면 이 응답은 그 변경 전 snapshot일 수 있다.
    if (
      expectedGeneration === sessionGeneration() &&
      expectedRevision === mutationRevision &&
      requestSequence === refreshSequence
    ) {
      validating = false;
      replaceBlockedUsers(nextUsers);
    }
    return nextUsers;
  });
  flight = request;
  request.then(
    () => {
      if (flight === request) {
        flight = null;
        // 변경 전 snapshot을 버린 경우 기존 차단 목록까지 복구하도록 최신 목록을 다시 읽는다.
        if (expectedGeneration === sessionGeneration() && expectedRevision !== mutationRevision) {
          refreshBlockedUsers().catch(() => {});
        } else if (validating) {
          validating = false;
          emit();
        }
      }
    },
    (error) => {
      if (flight === request) {
        flight = null;
        validating = false;
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

export function useBlockedUsers(
  active = true,
  revalidateActive = false,
): {
  ids: ReadonlySet<string>;
  users: ReadonlyArray<BlockedUser>;
  status: BlockedUsersLoadStatus;
  error: unknown;
  retry: () => Promise<BlockedUser[]>;
} {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const currentGeneration = sessionGeneration();
  const hasActivated = useRef(false);
  useEffect(() => {
    if (!active) return;
    const request =
      hasActivated.current || revalidateActive ? revalidateBlockedUsers() : loadBlockedUsers();
    hasActivated.current = true;
    request.catch(() => {});
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') revalidateBlockedUsers().catch(() => {});
    });
    return () => subscription.remove();
  }, [active, currentGeneration, revalidateActive]);
  return {
    ids,
    users,
    status: loadError ? 'error' : loaded && !validating ? 'ready' : 'loading',
    error: loadError,
    retry: refreshBlockedUsers,
  };
}

export function useBlockedUserIds(active = true): ReadonlySet<string> {
  return useBlockedUsers(active).ids;
}
