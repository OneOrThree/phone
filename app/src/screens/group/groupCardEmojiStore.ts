import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

export const GROUP_CARD_EMOJIS = [
  '🌅',
  '📚',
  '💻',
  '⚡',
  '🧘',
  '🎨',
  '🏃',
  '✍️',
  '🧠',
  '🎯',
  '🌿',
  '🔥',
] as const;

export type GroupCardEmoji = (typeof GROUP_CARD_EMOJIS)[number];
export const GROUP_CARD_EMOJI_LABELS: Record<GroupCardEmoji, string> = {
  '🌅': '일출',
  '📚': '책',
  '💻': '노트북',
  '⚡': '번개',
  '🧘': '명상',
  '🎨': '팔레트',
  '🏃': '달리기',
  '✍️': '글쓰기',
  '🧠': '두뇌',
  '🎯': '과녁',
  '🌿': '새싹',
  '🔥': '불꽃',
};
export const DEFAULT_GROUP_CARD_EMOJI: GroupCardEmoji = '🎯';
export type GroupCardEmojiBucket = Record<string, GroupCardEmoji>;
type GroupCardEmojiMap = Record<string, GroupCardEmojiBucket>;

const pendingEmojis = new Map<string, GroupCardEmoji>();
const pendingKey = (userId: string, groupId: string) => `${userId}\u0000${groupId}`;

export function isGroupCardEmoji(value: unknown): value is GroupCardEmoji {
  return typeof value === 'string' && (GROUP_CARD_EMOJIS as readonly string[]).includes(value);
}

export function normalizeGroupCardEmoji(value: unknown): GroupCardEmoji {
  return isGroupCardEmoji(value) ? value : DEFAULT_GROUP_CARD_EMOJI;
}

export function parseGroupCardEmoji(raw: string | null): GroupCardEmojiMap {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    const result: GroupCardEmojiMap = {};
    for (const [userId, bucket] of Object.entries(value)) {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
      result[userId] = Object.fromEntries(
        Object.entries(bucket).filter(([, emoji]) => isGroupCardEmoji(emoji)),
      ) as GroupCardEmojiBucket;
    }
    return result;
  } catch {
    return {};
  }
}

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const current = writeQueue.then(task);
  writeQueue = current.catch(() => undefined);
  return current;
}

export async function readGroupCardEmoji(
  userId: string | null,
  groupId: string,
): Promise<GroupCardEmoji> {
  if (!userId) return DEFAULT_GROUP_CARD_EMOJI;
  const pending = pendingEmojis.get(pendingKey(userId, groupId));
  if (pending) return pending;
  try {
    const map = parseGroupCardEmoji(await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji));
    return normalizeGroupCardEmoji(map[userId]?.[groupId]);
  } catch {
    return DEFAULT_GROUP_CARD_EMOJI;
  }
}

/** 같은 key의 계정×그룹 RMW 전체를 직렬화해 서로 다른 bucket의 동시 저장을 보존한다. */
export function writeGroupCardEmoji(
  userId: string,
  groupId: string,
  emoji: GroupCardEmoji,
): Promise<void> {
  const key = pendingKey(userId, groupId);
  pendingEmojis.set(key, emoji);
  return enqueueWrite(async () => {
    const map = parseGroupCardEmoji(await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji));
    await AsyncStorage.setItem(
      STORAGE_KEYS.groupCardEmoji,
      JSON.stringify({
        ...map,
        [userId]: { ...map[userId], [groupId]: emoji },
      }),
    );
  }).then(() => {
    // 같은 key에 더 최신 선택이 대기 중이면 앞선 저장 완료가 그것을 지우지 않는다.
    if (pendingEmojis.get(key) === emoji) pendingEmojis.delete(key);
  });
}

/** 현재 실행에서 실패했던 선택을 유지하고 다음 그룹 화면 활성화에서 다시 저장한다. */
export async function retryPendingGroupCardEmojis(
  userId: string,
  currentGroupIds: readonly string[],
): Promise<void> {
  const current = new Set(currentGroupIds);
  const prefix = `${userId}\u0000`;
  const pending = [...pendingEmojis.entries()].filter(
    ([key]) => key.startsWith(prefix) && current.has(key.slice(prefix.length)),
  );
  for (const [key, emoji] of pending) {
    const groupId = key.slice(prefix.length);
    try {
      await writeGroupCardEmoji(userId, groupId, emoji);
    } catch {
      // 다음 활성화에서도 같은 pending 값을 다시 시도한다.
    }
  }
}

/** 성공한 전체 소속 목록을 기준으로 현재 계정에서 사라진 그룹의 로컬 아이콘을 제거한다. */
export function reconcileGroupCardEmojis(
  userId: string,
  currentGroupIds: readonly string[],
): Promise<void> {
  const current = new Set(currentGroupIds);
  const prefix = `${userId}\u0000`;
  for (const key of pendingEmojis.keys()) {
    if (key.startsWith(prefix) && !current.has(key.slice(prefix.length))) pendingEmojis.delete(key);
  }
  return enqueueWrite(async () => {
    const map = parseGroupCardEmoji(await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji));
    const bucket = map[userId];
    if (!bucket) return;
    const retained = Object.fromEntries(
      Object.entries(bucket).filter(([groupId]) => current.has(groupId)),
    ) as GroupCardEmojiBucket;
    if (Object.keys(retained).length === Object.keys(bucket).length) return;

    const next = { ...map };
    if (Object.keys(retained).length === 0) delete next[userId];
    else next[userId] = retained;
    await AsyncStorage.setItem(STORAGE_KEYS.groupCardEmoji, JSON.stringify(next));
  });
}

export function __resetGroupCardEmojiQueueForTest(): void {
  writeQueue = Promise.resolve();
  pendingEmojis.clear();
}
