import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

type GroupOrderMap = Record<string, string[]>;

function uniqueIds(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function parseGroupCardOrder(raw: string | null): GroupOrderMap {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    const result: GroupOrderMap = {};
    for (const [userId, ids] of Object.entries(value)) {
      if (Array.isArray(ids)) result[userId] = uniqueIds(ids);
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * GET /groups의 성공한 전체 응답과 로컬 표시 순서를 합성한다.
 * 서버에 없는 ID와 중복은 제거하고 신규 ID는 서버 상대 순서로 뒤에 붙인다.
 * FindMoreCard는 이 함수에 전달되는 서버 groupId 목록 밖에서 합성하므로 저장 대상이 아니다.
 */
export function reconcileGroupCardOrder(
  serverGroupIds: readonly string[],
  storedGroupIds: readonly unknown[] | null | undefined,
): string[] {
  const serverIds = uniqueIds(serverGroupIds);
  const serverSet = new Set(serverIds);
  const storedIds = uniqueIds(storedGroupIds ?? []).filter((id) => serverSet.has(id));
  const storedSet = new Set(storedIds);
  return [...storedIds, ...serverIds.filter((id) => !storedSet.has(id))];
}

export function isSameGroupOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

let storageQueue: Promise<unknown> = Promise.resolve();

function enqueueStorageOperation<T>(task: () => Promise<T>): Promise<T> {
  const current = storageQueue.then(task);
  storageQueue = current.catch(() => undefined);
  return current;
}

export function readGroupCardOrder(userId: string): Promise<string[] | null> {
  return enqueueStorageOperation(async () => {
    try {
      const map = parseGroupCardOrder(await AsyncStorage.getItem(STORAGE_KEYS.groupCardOrder));
      return map[userId] ?? null;
    } catch {
      return null;
    }
  });
}

const reconcileGenerationByUser = new Map<string, number>();
const reconcileRecoveryOrderByUser = new Map<string, string[]>();

/** 성공한 전체 목록을 읽기와 같은 세대 인식 queue 안에서 합성·prune한다. */
export function reconcileStoredGroupCardOrder(
  userId: string,
  serverGroupIds: readonly string[],
  shouldContinue: () => boolean = () => true,
): Promise<string[] | null> {
  const generation = (reconcileGenerationByUser.get(userId) ?? 0) + 1;
  reconcileGenerationByUser.set(userId, generation);
  const isCurrent = () => reconcileGenerationByUser.get(userId) === generation && shouldContinue();

  return enqueueStorageOperation(async () => {
    if (!isCurrent()) return null;
    let raw: string | null;
    try {
      raw = await AsyncStorage.getItem(STORAGE_KEYS.groupCardOrder);
    } catch {
      return isCurrent() ? reconcileGroupCardOrder(serverGroupIds, null) : null;
    }
    const map = parseGroupCardOrder(raw);
    const recovery = reconcileRecoveryOrderByUser.get(userId);
    const stored = recovery ?? map[userId] ?? null;
    const reconciled = reconcileGroupCardOrder(serverGroupIds, stored);
    if (!isCurrent()) return null;

    if (stored && !isSameGroupOrder(stored, reconciled)) {
      try {
        await AsyncStorage.setItem(
          STORAGE_KEYS.groupCardOrder,
          JSON.stringify({ ...map, [userId]: reconciled }),
        );
        if (!isCurrent()) {
          // 더 최신 목록이 대기 중이면 오래된 prune을 되돌려 최신 요청이 실제 이전 순서에서
          // 다시 합성하게 한다. 복원 실패 시에는 메모리 snapshot을 다음 요청에 넘긴다.
          try {
            if (recovery) {
              await AsyncStorage.setItem(
                STORAGE_KEYS.groupCardOrder,
                JSON.stringify({ ...map, [userId]: stored }),
              );
            } else if (raw === null) {
              await AsyncStorage.removeItem(STORAGE_KEYS.groupCardOrder);
            } else {
              await AsyncStorage.setItem(STORAGE_KEYS.groupCardOrder, raw);
            }
            reconcileRecoveryOrderByUser.delete(userId);
          } catch {
            reconcileRecoveryOrderByUser.set(userId, stored);
          }
          return null;
        }
        reconcileRecoveryOrderByUser.delete(userId);
      } catch {
        // prune은 best-effort다. 정상적으로 읽은 합성 순서는 화면에 유지한다.
      }
    }
    return reconciled;
  });
}

/**
 * 한 AsyncStorage key에 여러 계정 버킷이 있으므로 read-modify-write 전체를 직렬화한다.
 * 큐 안에서 최신 map을 다시 읽어 다른 계정의 직전 쓰기를 보존한다.
 */
export function writeGroupCardOrder(userId: string, groupIds: readonly string[]): Promise<void> {
  const nextOrder = uniqueIds(groupIds);
  return enqueueStorageOperation(async () => {
    const map = parseGroupCardOrder(await AsyncStorage.getItem(STORAGE_KEYS.groupCardOrder));
    await AsyncStorage.setItem(
      STORAGE_KEYS.groupCardOrder,
      JSON.stringify({ ...map, [userId]: nextOrder }),
    );
    // 더 늦게 수락된 사용자의 명시적 순서는 실패한 prune 복구 snapshot보다 우선한다.
    reconcileRecoveryOrderByUser.delete(userId);
  });
}

export function __resetGroupCardOrderQueueForTest(): void {
  storageQueue = Promise.resolve();
  reconcileGenerationByUser.clear();
  reconcileRecoveryOrderByUser.clear();
}
