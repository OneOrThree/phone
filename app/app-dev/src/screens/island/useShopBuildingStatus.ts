import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getShopProducts, type ShopItem } from '@/services/api/shop';
import type { ShopMotionState } from '@/components/village-motion/ShopMotion';

type CatalogSnapshot = { knownIds: string[]; pendingIds: string[] };
const acknowledgements = new Map<string, Promise<ShopMotionState>>();

export function updateShopCatalogSnapshot(
  previous: CatalogSnapshot | null,
  items: ShopItem[],
): CatalogSnapshot {
  const availableIds = items
    .filter((item) => item.available && !item.owned && item.price !== null)
    .map((item) => item.id);
  if (!previous) return { knownIds: items.map((item) => item.id), pendingIds: [] };

  const known = new Set(previous.knownIds);
  const available = new Set(availableIds);
  const pending = new Set(previous.pendingIds.filter((id) => available.has(id)));
  for (const id of availableIds) {
    if (!known.has(id)) pending.add(id);
  }
  for (const item of items) known.add(item.id);
  return { knownIds: [...known], pendingIds: [...pending] };
}

async function readSnapshot(key: string): Promise<CatalogSnapshot | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as CatalogSnapshot).knownIds) &&
      Array.isArray((value as CatalogSnapshot).pendingIds)
    )
      return value as CatalogSnapshot;
  } catch {
    // 손상된 기기 캐시는 새 서버 스냅샷으로 다시 기준을 잡는다.
  }
  return null;
}

async function readCatalog(islandId: string): Promise<ShopItem[]> {
  const items: ShopItem[] = [];
  const categories = ['personal', 'island'] as const;
  for (const category of categories) {
    let cursor: string | undefined;
    const usedCursors = new Set<string>();
    do {
      const page = await getShopProducts(islandId, category, cursor);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (cursor && usedCursors.has(cursor)) {
        throw new Error(`Shop catalog repeated cursor: ${category}`);
      }
      if (cursor) usedCursors.add(cursor);
    } while (cursor);
  }
  return items;
}

export function acknowledgeShopForScope(key: string, islandId: string): Promise<ShopMotionState> {
  const existing = acknowledgements.get(key);
  if (existing) return existing;

  const task = (async (): Promise<ShopMotionState> => {
    try {
      const previous = await readSnapshot(key);
      let acknowledged = previous ?? { knownIds: [], pendingIds: [] };
      let acknowledgedStatus: ShopMotionState = 'normal';
      try {
        const items = await readCatalog(islandId);
        acknowledged = updateShopCatalogSnapshot(previous, items);
        if (items.some((item) => item.available && !item.owned && item.price !== null)) {
          acknowledgedStatus = 'purchasable';
        }
      } catch {
        // 상점 진입 자체는 확인으로 간주한다. 카탈로그 실패 시 다음 홈 조회가 다시 시도한다.
        if (!previous) return 'normal';
      }
      await AsyncStorage.setItem(key, JSON.stringify({ ...acknowledged, pendingIds: [] }));
      return acknowledgedStatus;
    } catch {
      // 저장소 장애는 읽음 작업의 거부로 전파하지 않는다. 다음 진입에서 다시 시도한다.
      return 'normal';
    }
  })();
  acknowledgements.set(key, task);
  const cleanup = () => {
    if (acknowledgements.get(key) === task) acknowledgements.delete(key);
  };
  task.then(cleanup, cleanup);
  return task;
}

export function useShopBuildingStatus({
  active,
  acknowledge,
  islandId,
  userId,
}: {
  active: boolean;
  /** 실제 상점 화면에 들어오면 새 상품 알림을 읽음 처리한다. */
  acknowledge: boolean;
  islandId: string | null;
  userId: string | null;
}): ShopMotionState {
  const [status, setStatus] = useState<ShopMotionState>('normal');
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const key = islandId && userId ? `gromo:shop-catalog:${userId}:${islandId}` : null;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') setForegroundEpoch((current) => current + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!key) {
      setStatus('normal');
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      if (acknowledge) {
        acknowledgeShopForScope(key, islandId!).catch(() => undefined);
        setStatus('normal');
        return;
      }
      if (!active) {
        setStatus('normal');
        return;
      }

      try {
        const acknowledgement = acknowledgements.get(key);
        if (acknowledgement) {
          await acknowledgement;
          if (cancelled) return;
        }
        if (cancelled) return;
        const [previous, items] = await Promise.all([readSnapshot(key), readCatalog(islandId!)]);
        if (cancelled) return;
        const next = updateShopCatalogSnapshot(previous, items);
        await AsyncStorage.setItem(key, JSON.stringify(next));
        if (cancelled) return;
        setStatus(
          next.pendingIds.length > 0
            ? 'new-product'
            : items.some((item) => item.available && !item.owned && item.price !== null)
              ? 'purchasable'
              : 'normal',
        );
      } catch {
        if (!cancelled) setStatus('normal');
      }
    };

    run().catch(() => {
      if (!cancelled) setStatus('normal');
    });
    return () => {
      cancelled = true;
    };
  }, [active, acknowledge, foregroundEpoch, islandId, key]);

  return status;
}
