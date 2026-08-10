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
export const DEFAULT_GROUP_CARD_EMOJI: GroupCardEmoji = '🎯';
export type GroupCardEmojiBucket = Record<string, GroupCardEmoji>;
type GroupCardEmojiMap = Record<string, GroupCardEmojiBucket>;

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
  try {
    const map = parseGroupCardEmoji(await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji));
    return normalizeGroupCardEmoji(map[userId]?.[groupId]);
  } catch {
    return DEFAULT_GROUP_CARD_EMOJI;
  }
}

/** 덱 hydrate에서 저장소를 카드 수만큼 읽지 않도록 현재 계정의 표시값을 한 번에 가져온다. */
export async function readGroupCardEmojis(
  userId: string | null,
  groupIds: readonly string[],
): Promise<GroupCardEmojiBucket> {
  if (!userId) return {};
  try {
    const map = parseGroupCardEmoji(await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji));
    const bucket = map[userId] ?? {};
    return Object.fromEntries(
      groupIds.map((groupId) => [groupId, normalizeGroupCardEmoji(bucket[groupId])]),
    );
  } catch {
    return {};
  }
}

/** 같은 key의 계정×그룹 RMW 전체를 직렬화해 서로 다른 bucket의 동시 저장을 보존한다. */
export function writeGroupCardEmoji(
  userId: string,
  groupId: string,
  emoji: GroupCardEmoji,
): Promise<void> {
  return enqueueWrite(async () => {
    const map = parseGroupCardEmoji(await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji));
    await AsyncStorage.setItem(
      STORAGE_KEYS.groupCardEmoji,
      JSON.stringify({
        ...map,
        [userId]: { ...map[userId], [groupId]: emoji },
      }),
    );
  });
}

export function __resetGroupCardEmojiQueueForTest(): void {
  writeQueue = Promise.resolve();
}
