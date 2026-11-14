import AsyncStorage from '@react-native-async-storage/async-storage';
import { ISLAND_INTRO_MAX, ISLAND_NAME_MAX } from '@/services/api/islandManagement';
import { CAPACITY_MAX, CAPACITY_MIN } from '@/services/model';
import { clampCodePoints } from '@/utils/codePoints';

export type CreateIslandDraft = {
  name: string;
  intro: string;
  capacity: number;
  approval: boolean;
};
export const emptyCreateIslandDraft: CreateIslandDraft = {
  name: '',
  intro: '',
  capacity: CAPACITY_MAX,
  approval: false,
};
export const createIslandDraftKey = (owner: string) =>
  `gromo.createIslandDraft.v1:${encodeURIComponent(owner)}`;
// 재진입의 읽기·빠른 입력의 쓰기·생성 성공 후 삭제가 앞선 작업을 추월하지 않는다.
const pending = new Map<string, Promise<unknown>>();
function enqueue<T>(owner: string, work: () => Promise<T>): Promise<T> {
  const next = (pending.get(owner) ?? Promise.resolve()).catch(() => {}).then(work);
  pending.set(owner, next);
  void next
    .finally(() => {
      if (pending.get(owner) === next) pending.delete(owner);
    })
    .catch(() => {});
  return next;
}
export function readCreateIslandDraft(owner: string): Promise<CreateIslandDraft | null> {
  return enqueue(owner, async () => {
    const raw = await AsyncStorage.getItem(createIslandDraftKey(owner));
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (typeof value?.name !== 'string' || typeof value?.intro !== 'string') return null;
      return {
        name: clampCodePoints(value.name, ISLAND_NAME_MAX),
        intro: clampCodePoints(value.intro, ISLAND_INTRO_MAX),
        capacity: Number.isInteger(value.capacity)
          ? Math.min(CAPACITY_MAX, Math.max(CAPACITY_MIN, value.capacity))
          : CAPACITY_MAX,
        approval: value.approval === true,
      };
    } catch {
      return null;
    }
  });
}
export function writeCreateIslandDraft(owner: string, value: CreateIslandDraft): Promise<void> {
  const raw = JSON.stringify(value);
  return enqueue(owner, () => AsyncStorage.setItem(createIslandDraftKey(owner), raw));
}
export function removeCreateIslandDraft(owner: string): Promise<void> {
  return enqueue(owner, () => AsyncStorage.removeItem(createIslandDraftKey(owner)));
}
