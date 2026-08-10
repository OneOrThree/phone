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

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const current = writeQueue.then(task);
  writeQueue = current.catch(() => undefined);
  return current;
}

export async function readGroupCardOrder(userId: string): Promise<string[] | null> {
  try {
    // hydration도 같은 key의 앞선 RMW가 끝난 뒤 읽는다. 저장 직후 serverKey가 바뀌어
    // 새 목록을 hydrate하더라도 저장 전 snapshot으로 최신 사용자 순서를 되돌리지 않는다.
    await writeQueue;
    const map = parseGroupCardOrder(await AsyncStorage.getItem(STORAGE_KEYS.groupCardOrder));
    return map[userId] ?? null;
  } catch {
    return null;
  }
}

/**
 * 한 AsyncStorage key에 여러 계정 버킷이 있으므로 read-modify-write 전체를 직렬화한다.
 * 큐 안에서 최신 map을 다시 읽어 다른 계정의 직전 쓰기를 보존한다.
 */
export function writeGroupCardOrder(userId: string, groupIds: readonly string[]): Promise<void> {
  const nextOrder = uniqueIds(groupIds);
  return enqueueWrite(async () => {
    const map = parseGroupCardOrder(await AsyncStorage.getItem(STORAGE_KEYS.groupCardOrder));
    await AsyncStorage.setItem(
      STORAGE_KEYS.groupCardOrder,
      JSON.stringify({ ...map, [userId]: nextOrder }),
    );
  });
}

export function __resetGroupCardOrderQueueForTest(): void {
  writeQueue = Promise.resolve();
}
