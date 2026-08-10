import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

export const GROUP_CARD_EMOJI_OPTIONS = [
  { emoji: '🌅', label: '일출' },
  { emoji: '📚', label: '책' },
  { emoji: '💻', label: '노트북' },
  { emoji: '⚡', label: '번개' },
  { emoji: '🧘', label: '명상' },
  { emoji: '🎨', label: '팔레트' },
  { emoji: '🏃', label: '달리기' },
  { emoji: '✍️', label: '쓰기' },
  { emoji: '🧠', label: '두뇌' },
  { emoji: '🎯', label: '목표' },
  { emoji: '🌿', label: '잎' },
  { emoji: '🔥', label: '불꽃' },
] as const;

export type GroupCardEmoji = (typeof GROUP_CARD_EMOJI_OPTIONS)[number]['emoji'];
export const GROUP_CARD_EMOJIS = GROUP_CARD_EMOJI_OPTIONS.map((option) => option.emoji);
export const DEFAULT_GROUP_CARD_EMOJI: GroupCardEmoji = '🎯';
export type GroupCardEmojiBucket = Record<string, GroupCardEmoji>;
export type GroupCardEmojiReadResult =
  | { status: 'ready'; emoji: GroupCardEmoji; storedEmoji: GroupCardEmoji }
  | { status: 'error' };
type GroupCardEmojiMap = Record<string, GroupCardEmojiBucket>;
type ParsedEmojiMap = { value: GroupCardEmojiMap; needsRepair: boolean };

export function isGroupCardEmoji(value: unknown): value is GroupCardEmoji {
  return typeof value === 'string' && GROUP_CARD_EMOJIS.includes(value as GroupCardEmoji);
}

export function normalizeGroupCardEmoji(value: unknown): GroupCardEmoji {
  return isGroupCardEmoji(value) ? value : DEFAULT_GROUP_CARD_EMOJI;
}

export function groupCardEmojiLabel(value: unknown): string {
  const emoji = normalizeGroupCardEmoji(value);
  return GROUP_CARD_EMOJI_OPTIONS.find((option) => option.emoji === emoji)?.label ?? '목표';
}

export function parseGroupCardEmojiState(raw: string | null): ParsedEmojiMap {
  if (!raw) return { value: {}, needsRepair: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { value: {}, needsRepair: true };
    }

    const result: GroupCardEmojiMap = {};
    let needsRepair = false;
    for (const [userId, bucket] of Object.entries(value)) {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
        needsRepair = true;
        continue;
      }
      const entries = Object.entries(bucket).filter(([, emoji]) => isGroupCardEmoji(emoji));
      if (entries.length !== Object.keys(bucket).length) needsRepair = true;
      result[userId] = Object.fromEntries(entries) as GroupCardEmojiBucket;
    }
    return { value: result, needsRepair };
  } catch {
    return { value: {}, needsRepair: true };
  }
}

export function parseGroupCardEmoji(raw: string | null): GroupCardEmojiMap {
  return parseGroupCardEmojiState(raw).value;
}

let storageQueue: Promise<unknown> = Promise.resolve();
type EmojiListener = (groupId: string, emoji: GroupCardEmoji) => void;
const emojiListeners = new Map<string, Set<EmojiListener>>();

export function subscribeGroupCardEmoji(userId: string, listener: EmojiListener): () => void {
  const listeners = emojiListeners.get(userId) ?? new Set<EmojiListener>();
  listeners.add(listener);
  emojiListeners.set(userId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) emojiListeners.delete(userId);
  };
}

function emitGroupCardEmoji(userId: string, groupId: string, emoji: GroupCardEmoji): void {
  emojiListeners.get(userId)?.forEach((listener) => listener(groupId, emoji));
}

function enqueueStorageOperation<T>(task: () => Promise<T>): Promise<T> {
  const current = storageQueue.then(task);
  storageQueue = current.catch(() => undefined);
  return current;
}

export async function readGroupCardEmojiResult(
  userId: string | null,
  groupId: string,
): Promise<GroupCardEmojiReadResult> {
  if (!userId) {
    return {
      status: 'ready',
      emoji: DEFAULT_GROUP_CARD_EMOJI,
      storedEmoji: DEFAULT_GROUP_CARD_EMOJI,
    };
  }
  return enqueueStorageOperation(async () => {
    try {
      const map = parseGroupCardEmoji(await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji));
      const storedEmoji = normalizeGroupCardEmoji(map[userId]?.[groupId]);
      const pendingEmoji = pendingEmojis.get(pendingKey(userId, groupId))?.emoji;
      return { status: 'ready', emoji: pendingEmoji ?? storedEmoji, storedEmoji };
    } catch {
      return { status: 'error' };
    }
  });
}

export async function readGroupCardEmoji(
  userId: string | null,
  groupId: string,
): Promise<GroupCardEmoji> {
  const result = await readGroupCardEmojiResult(userId, groupId);
  return result.status === 'ready' ? result.emoji : DEFAULT_GROUP_CARD_EMOJI;
}

/** 같은 key의 계정×그룹 RMW 전체를 직렬화해 서로 다른 bucket의 동시 저장을 보존한다. */
export function writeGroupCardEmoji(
  userId: string,
  groupId: string,
  emoji: GroupCardEmoji,
): Promise<void> {
  return enqueueStorageOperation(async () => {
    const map = parseGroupCardEmoji(await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji));
    await AsyncStorage.setItem(
      STORAGE_KEYS.groupCardEmoji,
      JSON.stringify({
        ...map,
        [userId]: { ...map[userId], [groupId]: emoji },
      }),
    );
    emitGroupCardEmoji(userId, groupId, emoji);
  });
}

function sameBucket(a: GroupCardEmojiBucket, b: GroupCardEmojiBucket): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

const reconcileGenerationByUser = new Map<string, number>();
// 무효화된 prune 뒤 원본 복원이 실패하면 잘려 나간 현재 계정 bucket만 보존한다. 다음
// reconcile은 이를 최신 raw bucket 아래에 병합해, 그 사이의 새 아이콘·다른 계정 저장을 되돌리지 않는다.
const reconcileRecoveryBucketByUser = new Map<string, GroupCardEmojiBucket>();

/** 성공한 전체 GET /groups에서만 호출해 현재 계정 bucket의 stale groupId를 제거한다. */
export function reconcileGroupCardEmojiBucket(
  userId: string,
  serverGroupIds: readonly string[],
  shouldContinue: () => boolean = () => true,
): Promise<GroupCardEmojiBucket | null> {
  const generation = (reconcileGenerationByUser.get(userId) ?? 0) + 1;
  reconcileGenerationByUser.set(userId, generation);
  const isCurrent = () => reconcileGenerationByUser.get(userId) === generation && shouldContinue();
  return enqueueStorageOperation(async () => {
    if (!isCurrent()) return {};
    let raw: string | null;
    try {
      raw = await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji);
    } catch {
      // 정상적인 빈 bucket과 구분해 호출부가 이미 표시 중인 아이콘을 유지하게 한다.
      return null;
    }
    const parsed = parseGroupCardEmojiState(raw);
    const recoveryBucket = reconcileRecoveryBucketByUser.get(userId);
    const current = recoveryBucket
      ? { ...recoveryBucket, ...parsed.value[userId] }
      : (parsed.value[userId] ?? {});
    const validIds = new Set(serverGroupIds);
    const next = Object.fromEntries(
      Object.entries(current).filter(([groupId]) => validIds.has(groupId)),
    ) as GroupCardEmojiBucket;

    if (!isCurrent()) return {};
    if (recoveryBucket || parsed.needsRepair || !sameBucket(current, next)) {
      try {
        await AsyncStorage.setItem(
          STORAGE_KEYS.groupCardEmoji,
          JSON.stringify({ ...parsed.value, [userId]: next }),
        );
        if (!isCurrent()) {
          // 같은 storage queue 뒤에 최신 reconcile이 대기한다. 먼저 원본을 복원해 최신 요청이
          // superseded prune 결과가 아닌 실제 이전 bucket에서 다시 계산하게 한다.
          try {
            if (recoveryBucket) {
              await AsyncStorage.setItem(
                STORAGE_KEYS.groupCardEmoji,
                JSON.stringify({ ...parsed.value, [userId]: current }),
              );
            } else if (raw === null) {
              await AsyncStorage.removeItem(STORAGE_KEYS.groupCardEmoji);
            } else {
              await AsyncStorage.setItem(STORAGE_KEYS.groupCardEmoji, raw);
            }
            reconcileRecoveryBucketByUser.delete(userId);
          } catch {
            reconcileRecoveryBucketByUser.set(userId, current);
          }
          return {};
        }
        reconcileRecoveryBucketByUser.delete(userId);
      } catch {
        // stale 정리는 best-effort다. 이미 정상적으로 읽은 현재 계정 아이콘은 UI에 유지한다.
      }
    }
    return next;
  });
}

type PendingEmoji = {
  userId: string;
  groupId: string;
  emoji: GroupCardEmoji;
  version: number;
  surface: 'create' | 'settings';
};
const pendingEmojis = new Map<string, PendingEmoji>();
const latestPendingSelection = new Map<string, { emoji: GroupCardEmoji; version: number }>();
let pendingVersion = 0;

function pendingKey(userId: string, groupId: string): string {
  return `${userId}:${groupId}`;
}

export function preservePendingGroupCardEmoji(
  userId: string,
  groupId: string,
  emoji: GroupCardEmoji,
  surface: 'create' | 'settings' = 'settings',
): void {
  const key = pendingKey(userId, groupId);
  const version = ++pendingVersion;
  pendingEmojis.set(key, { userId, groupId, emoji, version, surface });
  latestPendingSelection.set(key, { emoji, version });
  emitGroupCardEmoji(userId, groupId, emoji);
}

/** 저장 실패 뒤 편집 중인 최신 선택만 pending으로 유지하고 카드에도 즉시 합성한다. */
export function updatePendingGroupCardEmojiSelection(
  userId: string,
  groupId: string,
  selected: GroupCardEmoji,
  stored: GroupCardEmoji,
): void {
  const key = pendingKey(userId, groupId);
  const version = ++pendingVersion;
  const surface = pendingEmojis.get(key)?.surface ?? 'settings';
  latestPendingSelection.set(key, { emoji: selected, version });
  if (selected === stored) pendingEmojis.delete(key);
  else pendingEmojis.set(key, { userId, groupId, emoji: selected, version, surface });
  emitGroupCardEmoji(userId, groupId, selected);
}

/** 오래된 비동기 쓰기의 emit 뒤 현재 pending 선택을 카드에 다시 합성한다. */
export function restoreLatestPendingGroupCardEmoji(userId: string, groupId: string): void {
  const latest = latestPendingSelection.get(pendingKey(userId, groupId));
  if (latest) emitGroupCardEmoji(userId, groupId, latest.emoji);
}

export function clearPendingGroupCardEmoji(
  userId: string,
  groupId: string,
  emoji?: GroupCardEmoji,
): boolean {
  const key = pendingKey(userId, groupId);
  const pending = pendingEmojis.get(key);
  if (!pending) {
    const latest = latestPendingSelection.get(key);
    if (emoji !== undefined && latest?.emoji === emoji) {
      latestPendingSelection.delete(key);
      return true;
    }
    return false;
  }
  if (emoji !== undefined && pending.emoji !== emoji) return false;
  pendingEmojis.delete(key);
  if (latestPendingSelection.get(key)?.version === pending.version) {
    latestPendingSelection.delete(key);
  }
  return true;
}

/** 그룹 화면 활성화 뒤 성공한 전체 목록에 포함된 최신 pending 값만 재시도한다. */
export async function retryPendingGroupCardEmojis(
  userId: string,
  serverGroupIds: readonly string[],
  shouldContinue: () => boolean = () => true,
  onResult?: (surface: 'create' | 'settings', result: 'success' | 'failed') => void,
): Promise<GroupCardEmojiBucket> {
  if (!shouldContinue()) return {};
  const validIds = new Set(serverGroupIds);
  for (const [key, pending] of pendingEmojis) {
    if (!shouldContinue()) return {};
    if (pending.userId === userId && !validIds.has(pending.groupId)) {
      pendingEmojis.delete(key);
      latestPendingSelection.delete(key);
    }
  }
  const candidates = [...pendingEmojis.values()].filter(
    (pending) => pending.userId === userId && validIds.has(pending.groupId),
  );
  const visible = Object.fromEntries(
    candidates.map((pending) => [pending.groupId, pending.emoji]),
  ) as GroupCardEmojiBucket;
  for (const pending of candidates) {
    if (!shouldContinue()) return visible;
    const key = pendingKey(pending.userId, pending.groupId);
    if (pendingEmojis.get(key)?.version !== pending.version) continue;
    try {
      await writeGroupCardEmoji(pending.userId, pending.groupId, pending.emoji);
      onResult?.(pending.surface, 'success');
      const current = pendingEmojis.get(key);
      if (current?.version === pending.version) {
        pendingEmojis.delete(key);
        if (latestPendingSelection.get(key)?.version === pending.version) {
          latestPendingSelection.delete(key);
        }
      } else {
        // 오래된 쓰기가 내부 emit까지 마친 뒤 선택이 바뀌었다면 최신 화면 값을 즉시 복원한다.
        const latest = latestPendingSelection.get(key);
        if (latest) emitGroupCardEmoji(pending.userId, pending.groupId, latest.emoji);
      }
    } catch {
      onResult?.(pending.surface, 'failed');
      // 다음 그룹 화면 활성화에서 최신 pending 값만 다시 시도한다.
    }
  }
  return {
    ...visible,
    ...(Object.fromEntries(
      [...pendingEmojis.values()]
        .filter((pending) => pending.userId === userId && validIds.has(pending.groupId))
        .map((pending) => [pending.groupId, pending.emoji]),
    ) as GroupCardEmojiBucket),
  };
}

export function __resetGroupCardEmojiQueueForTest(): void {
  storageQueue = Promise.resolve();
  pendingEmojis.clear();
  latestPendingSelection.clear();
  pendingVersion = 0;
  emojiListeners.clear();
  reconcileGenerationByUser.clear();
  reconcileRecoveryBucketByUser.clear();
}
