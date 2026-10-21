import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSession } from '@/services/api/session';

/**
 * 옷장에서 아직 안 본 새 꾸미기(GROMO-2382) — 결과창에서 NEW 로 받은 상품 id. 기기 로컬·사용자별이고, 옷장에서 그 칸을 한 번
 * 누르면 뺀다. 저장·읽기에 실패해도 이번 실행 동안은 메모리로 동작한다(화면은 배지가 덜 보일 뿐 깨지지 않는다).
 * 넣은 기록 id 도 기억해 같은 결과창을 다시 보여도 이미 본 아이템이 NEW 로 돌아오지 않는다.
 */
const keyOf = (userId: string) => `gromo.unseenOutfits.${userId}`;
// ponytail: 최근 기록 50개만 기억한다 — 그보다 오래된 결과창을 다시 열면 NEW 가 다시 붙을 수 있다
const RECORD_LIMIT = 50;
const EMPTY: ReadonlySet<string> = new Set();
type Box = {
  userId: string;
  ids: Set<string>;
  records: string[];
  /** 저장본을 한 번이라도 읽었는가 — 못 읽었으면 저장하지 않는다(저장본을 덮어쓰지 않게). */
  loaded: boolean;
  ready: Promise<void>;
};
let current: Box | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** 저장본을 메모리에 합친다. */
const read = (box: Box) =>
  AsyncStorage.getItem(keyOf(box.userId))
    .then((raw) => {
      const saved: { ids?: unknown; records?: unknown } = raw ? JSON.parse(raw) : {};
      if (Array.isArray(saved.ids))
        saved.ids.forEach((id) => typeof id === 'string' && box.ids.add(id));
      if (Array.isArray(saved.records))
        saved.records.forEach(
          (id) => typeof id === 'string' && !box.records.includes(id) && box.records.push(id),
        );
      box.loaded = true;
    })
    .catch(() => {});

function forUser(userId: string) {
  if (current?.userId === userId) return current;
  const box: Box = { userId, ids: new Set(), records: [], loaded: false, ready: Promise.resolve() };
  box.ready = read(box).then(notify);
  current = box;
  return box;
}

/** change 가 false 면 바뀐 게 없다. */
async function update(change: (box: Box) => boolean) {
  const userId = getSession()?.userId;
  if (!userId) return;
  const box = forUser(userId);
  await box.ready;
  // 처음 읽기에 실패했으면 쓰기 전에 한 번 더 읽어 합친다
  if (!box.loaded) await read(box);
  if (!change(box)) return;
  notify();
  if (!box.loaded) return;
  await AsyncStorage.setItem(
    keyOf(userId),
    JSON.stringify({ ids: [...box.ids], records: box.records }),
  ).catch(() => {});
}

/** 결과창(기록 recordId)에서 처음 받은 상품을 넣는다 — 같은 기록은 한 번만. */
export const addUnseenOutfits = (recordId: string, productIds: readonly string[]) =>
  productIds.length
    ? update((box) => {
        if (box.records.includes(recordId)) return false;
        box.records = [...box.records, recordId].slice(-RECORD_LIMIT);
        productIds.forEach((id) => box.ids.add(id));
        return true;
      })
    : Promise.resolve();

export const markOutfitSeen = (productId: string) => update((box) => box.ids.delete(productId));

/** 옷장용 — 로그인한 사용자의 안 본 새 꾸미기. 바뀌면 다시 그린다. */
export function useUnseenOutfits(): ReadonlySet<string> {
  const userId = getSession()?.userId ?? null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!userId) return;
    const rerender = () => setTick((n) => n + 1);
    listeners.add(rerender);
    forUser(userId).ready.then(rerender);
    return () => {
      listeners.delete(rerender);
    };
  }, [userId]);
  return userId && current?.userId === userId ? current.ids : EMPTY;
}

export function resetUnseenOutfitsForTest() {
  current = null;
  listeners.clear();
}
