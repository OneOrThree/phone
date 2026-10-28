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
  /** 집중 보상 머리·목(GROMO-2382) — 있으면 width·height·anchor 대신 이 자료로 자세별로 그린다. */
  catFit?: CatFit;
};

/** [left, top, right, bottom] — right·bottom 은 제외 경계(원본 PNG 픽셀). */
export type Box = readonly [number, number, number, number];
/** 고양이를 키워·옮겨 그린 정지 그림(프로필)에서 리그 좌표 q 를 그림 좌표 scale·q + (x, y) 로 옮긴다. */
export type CatFitView = { x: number; y: number; scale: number };
export type CatFitContact = { x: number; y: number; angleDegrees: number; view?: CatFitView };

/**
 * `renderData` 의 cat-fit-v1(server/scripts/customization/README.md「그림 정보 읽기」) — 좌표는 black-cat-512(512²) 픽셀이다.
 * 경로는 imageUrl 과 같은 정적 base 로 보완한 절대 주소다.
 */
export type CatFit = {
  /** source 원본 PNG 픽셀 크기. */
  width: number;
  height: number;
  /** source.crop — 알파 영역. */
  crop: Box;
  /** 검증된 털색 — 옛 자료(validatedColors 없음)는 검정만. 여기에 없는 털색은 그리지 않는다. */
  colors: readonly string[];
  /** 검증된 자세별 프레임 수(walk·focus·reel·blink·read) — 프레임 id 는 `<자세>-<번호>`. */
  motions: Readonly<Record<string, number>>;
  /** 검증된 정지 그림(idle·loaf·avatar) — 프레임 id 는 `still/<이름>`. */
  stills: readonly string[];
  /** 털색별 rig 절대 주소 — 검정은 rigPath, 나머지는 colorRigPaths. */
  rigUrls: Readonly<Record<string, string>>;
  head?: {
    drawWidth: number;
    depthY: number;
    /** 털색 → 프레임 id → 접촉점(검정은 contactFrames, 나머지는 colorContactFrames). */
    contacts: Readonly<Record<string, Readonly<Record<string, CatFitContact>>>>;
    shadow: { widthFactor: number; height: number };
  };
  neck?: {
    style: 'pendant' | 'bow' | 'scarf';
    front: Box;
    /** 스카프 앞 장식의 원본 열별 윗변 y(없는 열은 null). */
    columns?: readonly (number | null)[];
    /** 아이템 자체의 감는 띠. 없으면 공통 목줄(commonBand)을 쓴다. */
    band?: Box;
    commonBand: { url: string; box: Box };
  };
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

const finite = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const record = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const isBox = (v: unknown): v is Box => Array.isArray(v) && v.length === 4 && v.every(finite);
const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null;
const isView = (v: unknown) => {
  const r = record(v);
  return !!r && finite(r.x) && finite(r.y) && finite(r.scale);
};
/** 프레임 id → 접촉점 표. 한 칸이라도 틀리면 null. */
const contactTable = (v: unknown): Record<string, CatFitContact> | null => {
  const r = record(v);
  const valid =
    !!r &&
    Object.values(r).every((c) => {
      const p = record(c);
      return (
        !!p &&
        finite(p.x) &&
        finite(p.y) &&
        finite(p.angleDegrees) &&
        (p.view === undefined || isView(p.view))
      );
    });
  return valid ? (r as Record<string, CatFitContact>) : null;
};

/** renderData(cat-fit-v1) → CatFit. 머리·목만 — 슬롯에 필요한 칸이 하나라도 틀리거나 다른 슬롯(신발 등)이면 null. */
function parseCatFit(raw: unknown, slot: CatalogSlot, imageUrl: string): CatFit | null {
  const r = record(raw);
  const source = record(r?.source);
  const motions = record(r?.validatedMotions);
  if (r?.format !== 'cat-fit-v1' || !source || !isBox(source.crop) || !motions) return null;
  if (typeof source.path !== 'string' || typeof r.rigPath !== 'string') return null;
  if (!finite(source.width) || !finite(source.height)) return null;
  if (!Object.values(motions).every(finite)) return null;
  const colors = r.validatedColors === undefined ? ['black'] : strings(r.validatedColors);
  const stills = r.validatedStills === undefined ? [] : strings(r.validatedStills);
  const colorRigs = r.colorRigPaths === undefined ? {} : record(r.colorRigPaths);
  if (!colors || !stills || !colorRigs) return null;
  if (!Object.values(colorRigs).every((p) => typeof p === 'string')) return null;
  // 그림 안의 다른 경로(rig·공통 목줄)도 imageUrl 과 같은 정적 base 에서 받는다
  const base = imageUrl.endsWith(source.path)
    ? imageUrl.slice(0, -source.path.length)
    : API_URL.replace(/\/+$/, '');
  const resolve = (path: string) =>
    /^[a-z][a-z0-9+.-]*:/i.test(path) ? path : `${base}/${path.replace(/^\/+/, '')}`;
  const fit: CatFit = {
    width: source.width,
    height: source.height,
    crop: source.crop,
    colors,
    motions: motions as Record<string, number>,
    stills,
    rigUrls: Object.fromEntries(
      Object.entries({ ...colorRigs, black: r.rigPath }).map(([c, p]) => [c, resolve(p as string)]),
    ),
  };
  if (slot === 'head') {
    const black = contactTable(r.contactFrames);
    const others = r.colorContactFrames === undefined ? {} : record(r.colorContactFrames);
    const shadow = record(r.contactShadow);
    if (!finite(r.drawWidth) || !finite(r.itemDepthY) || !black || !others || !shadow) return null;
    const contacts: Record<string, Record<string, CatFitContact>> = { black };
    for (const [color, table] of Object.entries(others)) {
      const parsed = contactTable(table);
      if (!parsed) return null;
      contacts[color] = parsed;
    }
    if (!finite(shadow.widthFactor) || !finite(shadow.height)) return null;
    fit.head = {
      drawWidth: r.drawWidth,
      depthY: r.itemDepthY,
      contacts,
      shadow: { widthFactor: shadow.widthFactor, height: shadow.height },
    };
    return fit;
  }
  if (slot === 'neck') {
    const views = record(r.views);
    const front = record(views?.front);
    const band = record(views?.band);
    const common = record(r.commonBand);
    const style = r.neckStyle;
    if (style !== 'pendant' && style !== 'bow' && style !== 'scarf') return null;
    if (!front || !isBox(front.box) || !common || typeof common.path !== 'string') return null;
    const commonBox = record(common.view)?.box;
    if (!isBox(commonBox) || (band && !isBox(band.box))) return null;
    if (style === 'scarf' && (!band || !Array.isArray(front.columns))) return null;
    fit.neck = {
      style,
      front: front.box,
      ...(Array.isArray(front.columns) ? { columns: front.columns as (number | null)[] } : {}),
      ...(band ? { band: band.box as Box } : {}),
      commonBand: { url: resolve(common.path), box: commonBox },
    };
    return fit;
  }
  return null;
}

/** 서버 배열 → 표. 모양이 틀린 항목은 버린다(renderData 가 있는데 틀리면 항목째 버린다). */
export function parseCatalog(raw: unknown): CatalogTable {
  const table: Record<string, CatalogEntry> = {};
  if (!Array.isArray(raw)) return EMPTY;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.productId !== 'string' || typeof r.slot !== 'string' || !SLOTS.includes(r.slot))
      continue;
    if (typeof r.imageUrl !== 'string' || !r.imageUrl) continue;
    const imageUrl = absolute(r.imageUrl);
    const catFit =
      r.renderData == null ? null : parseCatFit(r.renderData, r.slot as CatalogSlot, imageUrl);
    if (r.renderData != null && !catFit) continue;
    table[r.productId] = {
      productId: r.productId,
      kind: typeof r.kind === 'string' ? r.kind : r.slot,
      slot: r.slot as CatalogSlot,
      title: typeof r.title === 'string' && r.title ? r.title : r.productId,
      imageUrl,
      width: num(r.width, 512),
      height: num(r.height, 512),
      anchorX: num(r.anchorX, 0.5),
      anchorY: num(r.anchorY, 0.5),
      sortOrder: num(r.sortOrder, 0),
      retiredAt: typeof r.retiredAt === 'string' ? r.retiredAt : null,
      ...(catFit ? { catFit } : {}),
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
