import { useEffect, useState } from 'react';
import { API_URL, request } from '@/services/api/client';

export type CatalogSlot = 'clothes' | 'decor' | 'head' | 'neck' | 'shoes';

/** `GET /customization/catalog` 항목(GROMO-2331). width/height 는 512 기준 고양이 상자 위의 픽셀, anchor 는 고양이 상자 안 0~1 위치(그림 중심이 놓인다). */
export type CatalogEntry = {
  productId: string;
  kind: string;
  slot: CatalogSlot;
  title: string;
  /** 절대 주소 — 서버가 `/static/...` 상대 경로를 주면 API base 로 보완한 값. */
  imageUrl: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  sortOrder: number;
  /** 있으면 퇴역 — 옷장 서랍에는 안 나오지만 이미 장착 중이면 그린다. */
  retiredAt: string | null;
};

export type CatalogTable = Readonly<Record<string, CatalogEntry>>;

const TTL_MS = 60 * 60 * 1000;
/** 실패(404 포함)는 짧게만 기억해 화면마다 서버를 두드리지 않는다. */
const FAILURE_TTL_MS = 60 * 1000;
const SLOTS: readonly string[] = ['clothes', 'decor', 'head', 'neck', 'shoes'];

const EMPTY: CatalogTable = {};
let cache: { table: CatalogTable; expires: number } | null = null;
let inflight: Promise<CatalogTable> | null = null;
const listeners = new Set<(table: CatalogTable) => void>();

const num = (v: unknown, fallback: number) => (typeof v === 'number' && isFinite(v) ? v : fallback);

const absolute = (url: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(url)
    ? url
    : `${API_URL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;

/** 서버 배열 → 표. 모양이 틀린 항목은 버린다. */
export function parseCatalog(raw: unknown): CatalogTable {
  const table: Record<string, CatalogEntry> = {};
  if (!Array.isArray(raw)) return EMPTY;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.productId !== 'string' || typeof r.slot !== 'string' || !SLOTS.includes(r.slot))
      continue;
    if (typeof r.imageUrl !== 'string' || !r.imageUrl) continue;
    table[r.productId] = {
      productId: r.productId,
      kind: typeof r.kind === 'string' ? r.kind : r.slot,
      slot: r.slot as CatalogSlot,
      title: typeof r.title === 'string' && r.title ? r.title : r.productId,
      imageUrl: absolute(r.imageUrl),
      width: num(r.width, 512),
      height: num(r.height, 512),
      anchorX: num(r.anchorX, 0.5),
      anchorY: num(r.anchorY, 0.5),
      sortOrder: num(r.sortOrder, 0),
      retiredAt: typeof r.retiredAt === 'string' ? r.retiredAt : null,
    };
  }
  return table;
}

/** 카탈로그를 읽는다 — 1시간 메모리 캐시, 실패·404 는 빈 표(옛 서버 호환). */
export function loadCustomizationCatalog(now: number = Date.now()): Promise<CatalogTable> {
  if (cache && cache.expires > now) return Promise.resolve(cache.table);
  inflight ??= request<unknown>('/customization/catalog')
    .then(parseCatalog, () => null)
    .then((table) => {
      cache = table
        ? { table, expires: Date.now() + TTL_MS }
        : { table: cache?.table ?? EMPTY, expires: Date.now() + FAILURE_TTL_MS };
      listeners.forEach((fn) => fn(cache!.table));
      return cache.table;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const snapshot = (): CatalogTable => cache?.table ?? EMPTY;

export const byProductId = (productId: string): CatalogEntry | undefined => snapshot()[productId];

/** 슬롯별 목록 — sortOrder 순. 퇴역 항목 포함(서랍에서 거르려면 `retiredAt` 확인). */
export const forSlot = (slot: CatalogSlot): CatalogEntry[] =>
  Object.values(snapshot())
    .filter((entry) => entry.slot === slot)
    .sort((a, b) => a.sortOrder - b.sortOrder);

/** 화면용 — 처음 쓰일 때 한 번 읽고, 다시 읽히면 갱신한다. */
export function useCustomizationCatalog(): CatalogTable {
  const [table, setTable] = useState<CatalogTable>(snapshot);
  useEffect(() => {
    listeners.add(setTable);
    let live = true;
    loadCustomizationCatalog().then((next) => live && setTable(next));
    return () => {
      live = false;
      listeners.delete(setTable);
    };
  }, []);
  return table;
}

export function resetCustomizationCatalogForTest() {
  cache = null;
  inflight = null;
}
