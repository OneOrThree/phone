import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { getShopProducts, type ShopItem } from '@/services/api/shop';
import type { ShopMotionState } from '@/components/village-motion/ShopMotion';

type CatalogSnapshot = { knownIds: string[]; pendingIds: string[] };
export function updateShopCatalogSnapshot(
  previous: CatalogSnapshot | null,
  items: ShopItem[],
): CatalogSnapshot {
  const availableIds = items.filter((item) => item.available && !item.owned).map((item) => item.id);
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
      if (cursor && usedCursors.has(cursor)) return items;
      if (cursor) usedCursors.add(cursor);
    } while (cursor);
  }
  return items;
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
  const key = islandId && userId ? `gromo:shop-catalog:${userId}:${islandId}` : null;

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
        const previous = await readSnapshot(key);
        let acknowledged = previous ?? { knownIds: [], pendingIds: [] };
        try {
          const items = await readCatalog(islandId!);
          acknowledged = updateShopCatalogSnapshot(previous, items);
        } catch {
          // 상점 화면이 열렸다는 사실은 유지하고, 다음 홈 진입에서 실패한 카탈로그를 다시 읽는다.
        }
        if (cancelled) return;
        await AsyncStorage.setItem(key, JSON.stringify({ ...acknowledged, pendingIds: [] }));
        setStatus('normal');
        return;
      }
      if (!active) {
        setStatus('normal');
        return;
      }

      try {
        const [previous, items] = await Promise.all([readSnapshot(key), readCatalog(islandId!)]);
        if (cancelled) return;
        const next = updateShopCatalogSnapshot(previous, items);
        await AsyncStorage.setItem(key, JSON.stringify(next));
        if (cancelled) return;
        setStatus(
          next.pendingIds.length > 0
            ? 'new-product'
            : items.some((item) => item.available && !item.owned)
              ? 'purchasable'
              : 'normal',
        );
      } catch {
        if (!cancelled) setStatus('normal');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [active, acknowledge, islandId, key]);

  return status;
}
