import { useEffect, useState } from 'react';
import { API_URL, ApiError, request } from '@/services/api/client';
import { getSession, sessionGeneration } from '@/services/api/session';

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
/** 실패(404 포함)는 짧게만 기억해 화면마다 서버를 두드리지 않는다. 연속 실패마다 2배(상한 10분), 성공하면 초기화. */
const FAILURE_TTL_MS = 60 * 1000;
const FAILURE_TTL_MAX_MS = 10 * 60 * 1000;
let failures = 0;
const SLOTS: readonly string[] = ['clothes', 'decor', 'head', 'neck', 'shoes'];

const EMPTY: CatalogTable = {};
let cache: { scope: string; table: CatalogTable; expires: number; failed: boolean } | null = null;
let inflight: { scope: string; promise: Promise<CatalogTable> } | null = null;
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

const failureTtl = () =>
  Math.min(FAILURE_TTL_MS * 2 ** Math.max(0, failures - 1), FAILURE_TTL_MAX_MS);

/** 로그인 범위 — 세대·userId 가 바뀌면 캐시(성공·실패 모두)를 버린다. 로그인 전이면 null. */
const scopeNow = (): string | null => {
  const userId = getSession()?.userId;
  return userId ? `${sessionGeneration()}:${userId}` : null;
};

/**
 * 카탈로그를 읽는다 — 1시간 메모리 캐시, 404·실패는 빈 표(옛 서버 호환, 1분만 기억).
 * 로그인 전에는 조회하지 않고(빈 표, 캐시 안 함), 401 도 캐시하지 않는다(인증 문제는 로그인 세대 변경이 푼다).
 */
export function loadCustomizationCatalog(now: number = Date.now()): Promise<CatalogTable> {
  const scope = scopeNow();
  if (!scope) return Promise.resolve(EMPTY);
  if (cache && cache.scope === scope && cache.expires > now) return Promise.resolve(cache.table);
  if (inflight && inflight.scope === scope) return inflight.promise;
  const promise: Promise<CatalogTable> = request<unknown>('/customization/catalog')
    .then(
      (raw) => ({ table: parseCatalog(raw), failed: false, auth: false }),
      (thrown) => ({
        table: EMPTY,
        failed: true,
        auth: thrown instanceof ApiError && thrown.status === 401,
      }),
    )
    .then((result) => {
      // 요청 중 로그인이 바뀌었으면 이 결과는 버린다
      if (scopeNow() !== scope) return EMPTY;
      if (result.auth) return EMPTY;
      failures = result.failed ? failures + 1 : 0;
      cache = {
        scope,
        failed: result.failed,
        table: result.failed ? (cache?.scope === scope ? cache.table : EMPTY) : result.table,
        expires: Date.now() + (result.failed ? failureTtl() : TTL_MS),
      };
      listeners.forEach((fn) => fn(cache!.table));
      return cache.table;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { scope, promise };
  return promise;
}

const snapshot = (): CatalogTable => (cache && cache.scope === scopeNow() ? cache.table : EMPTY);

export const byProductId = (productId: string): CatalogEntry | undefined => snapshot()[productId];

/** 슬롯별 목록 — sortOrder 순. 퇴역 항목 포함(서랍에서 거르려면 `retiredAt` 확인). */
export const forSlot = (slot: CatalogSlot): CatalogEntry[] =>
  Object.values(snapshot())
    .filter((entry) => entry.slot === slot)
    .sort((a, b) => a.sortOrder - b.sortOrder);

/** 화면용 — 로그인 범위가 바뀌면 다시 읽고, 실패 캐시가 만료되면 화면에 머물러도 다시 읽는다. */
export function useCustomizationCatalog(): CatalogTable {
  const scope = scopeNow();
  const [table, setTable] = useState<CatalogTable>(snapshot);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = (next: CatalogTable) => live && setTable(next);
    listeners.add(apply);
    const run = () =>
      loadCustomizationCatalog().then((next) => {
        if (!live) return;
        setTable(next);
        // 실패 캐시는 만료되면 한 번 더 읽어 복구한다
        if (cache?.failed && cache.scope === scopeNow())
          timer = setTimeout(run, Math.max(0, cache.expires - Date.now()) + 50);
      });
    setTable(snapshot());
    void run();
    return () => {
      live = false;
      clearTimeout(timer);
      listeners.delete(apply);
    };
  }, [scope]);
  return table;
}

export function resetCustomizationCatalogForTest() {
  failures = 0;
  cache = null;
  inflight = null;
}
