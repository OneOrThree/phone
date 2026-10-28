import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

type GroupOrderMap = Record<string, string[]>;
interface ParsedGroupOrder {
  value: GroupOrderMap;
  needsRepair: boolean;
}

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

export function parseGroupCardOrderState(raw: string | null): ParsedGroupOrder {
  if (raw === null) return { value: {}, needsRepair: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { value: {}, needsRepair: true };
    }

    const result: GroupOrderMap = {};
    let needsRepair = false;
    for (const [userId, ids] of Object.entries(value)) {
      if (!Array.isArray(ids)) {
        needsRepair = true;
        continue;
      }
      const normalized = uniqueIds(ids);
      if (normalized.length !== ids.length) needsRepair = true;
      result[userId] = normalized;
    }
    return { value: result, needsRepair };
  } catch {
    return { value: {}, needsRepair: true };
  }
}

function needsRepairForUser(raw: string | null, userId: string): boolean {
  if (raw === null) return false;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
    if (!Object.prototype.hasOwnProperty.call(value, userId)) return false;
    const ids = (value as Record<string, unknown>)[userId];
    return !Array.isArray(ids) || uniqueIds(ids).length !== ids.length;
  } catch {
    return true;
  }
}

export function parseGroupCardOrder(raw: string | null): GroupOrderMap {
  return parseGroupCardOrderState(raw).value;
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
export interface PendingGroupCardOrder {
  ids: string[];
  status: 'inflight' | 'failed';
  version: number;
}
const sessionPendingOrders = new Map<string, PendingGroupCardOrder>();
let pendingVersion = 0;

export function getPendingGroupCardOrder(userId: string): PendingGroupCardOrder | undefined {
  return sessionPendingOrders.get(userId);
}

export function setPendingGroupCardOrder(
  userId: string,
  ids: readonly string[],
  status: PendingGroupCardOrder['status'],
): PendingGroupCardOrder {
  const pending = { ids: uniqueIds(ids), status, version: ++pendingVersion };
  sessionPendingOrders.set(userId, pending);
  return pending;
}

export function updatePendingGroupCardOrderStatus(
  userId: string,
  version: number,
  status: PendingGroupCardOrder['status'],
): boolean {
  const pending = sessionPendingOrders.get(userId);
  if (!pending || pending.version !== version) return false;
  pending.status = status;
  return true;
}

export function clearPendingGroupCardOrder(userId: string, version: number): boolean {
  const pending = sessionPendingOrders.get(userId);
  if (!pending || pending.version !== version) return false;
  sessionPendingOrders.delete(userId);
  return true;
}

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const current = writeQueue.then(task);
  writeQueue = current.catch(() => undefined);
  return current;
}

export interface GroupCardOrderRead {
  order: string[] | null;
  needsRepair: boolean;
  readFailed: boolean;
}

export async function readGroupCardOrderState(userId: string): Promise<GroupCardOrderRead> {
  // 호출 시점까지 enqueue된 쓰기가 끝난 다음 읽는다. 재정렬 직후 재마운트가 이전 값을
  // hydrate해 최신 선택을 덮는 것을 막는다. 이후 enqueue된 쓰기는 이 읽기의 대상이 아니다.
  const pendingWrites = writeQueue;
  try {
    await pendingWrites;
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.groupCardOrder);
    const parsed = parseGroupCardOrderState(raw);
    return {
      order: parsed.value[userId] ?? null,
      needsRepair: needsRepairForUser(raw, userId),
      readFailed: false,
    };
  } catch {
    return { order: null, needsRepair: false, readFailed: true };
  }
}

export async function readGroupCardOrder(userId: string): Promise<string[] | null> {
  return (await readGroupCardOrderState(userId)).order;
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
  sessionPendingOrders.clear();
  pendingVersion = 0;
}
