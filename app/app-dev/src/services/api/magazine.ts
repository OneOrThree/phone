/**
 * 고양이 잡지 API(GROMO-2289) — 공개 business-api 의 무접두 경로, `{data}` 언랩. 서버 PR 이 아직 없어 구현계획 3장의
 * 계약 모양대로 쓰고 테스트는 fetch 스텁으로 본다. 목업(?demo · ?review · EXPO_PUBLIC_DEMO)에서는 `magazineMock` 이
 * 같은 함수 모양으로 대신한다.
 *
 *  - `GET  /me/magazine/assets`                     꾸미기 재료(틀·스티커·테이프)와 보유(owned). 지금 재료는 전부 무료다.
 *  - `GET  /islands/{id}/promotions/editor`         쓰기 화면 불러오기 — 신청 창, 다음 호 홍보(next), 지난번 칸(latest),
 *                                                   홍보비, 섬 통장 잔액, 비공개 섬 여부. 섬장·소셜 계정만(게스트 403).
 *  - `POST /islands/{id}/promotions`                신청 `{ body, layout }` — `Idempotency-Key` 필수(같은 의도 = 같은 키).
 *  - `PUT  /islands/{id}/promotions/{promotionId}`  고치기 — 신청 창(전날 07~24시) 안에서만, 돈은 다시 빼지 않는다. 키 없음.
 *  - `GET  /islands/{id}/news?limit=`               섬 소식(주민만) — 홍보를 내면 `PROMOTION` 소식이 생긴다.
 */
import { ApiError, request } from './client';
import { CLIENT_CONTRACT_ERROR } from './home';
import type { PromotionLayout, StickerPlacement, TapePlacement } from '@/screens/magazine/layout';

export type MagazineAsset = { assetId: string; bundle: 'free' | 'season'; owned: boolean };
export type MagazineAssets = {
  frames: MagazineAsset[];
  stickers: (MagazineAsset & { tab: string })[];
  tapes: MagazineAsset[];
};

/** 신청 창 — 07~24시 KST 면 open, issueDate = 실릴 호(내일). 00~07시는 닫혀 opensAt(07시)에 다시 열린다. */
export type PromotionWindow = {
  open: boolean;
  issueDate: string;
  closesAt: string;
  opensAt: string;
};
export type PromotionDraft = { body: string; layout: PromotionLayout };
export type SavedPromotion = PromotionDraft & { promotionId: string; issueDate: string };
export type PromotionEditor = {
  window: PromotionWindow;
  /** 아직 발행 전인 이 섬의 홍보. editable=false 면 마감(00시)이 지나 07시 발행만 기다린다. */
  next: (SavedPromotion & { appliedAt: string; editable: boolean }) | null;
  /** 지난번에 실은 칸 — next 가 없으면 화면을 이것으로 연다(AD-08). */
  latest: SavedPromotion | null;
  feeFish: number;
  balance: number;
  privateIsland: boolean;
};
export type PromotionApplied = {
  promotionId: string;
  issueDate: string;
  feeFish: number;
  balanceAfter: number;
  newsId: string;
};
export type PromotionUpdated = SavedPromotion & { updatedAt: string };
export type IslandNewsItem = { id: string; kind: string; body: string; createdAt: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const contractError = (field: string) =>
  new ApiError(CLIENT_CONTRACT_ERROR, `계약과 다른 응답입니다 (${field}).`, 0, { field });
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/**
 * 레이아웃은 화면이 그대로 그리므로 모양을 확인하고 모자란 값만 걸러 낸다 — 이상한 스티커 한 장 때문에 칸 전체가
 * 오류가 되지 않게 그 스티커만 뺀다(모르는 재료 id 는 AdCell 이 건너뛴다).
 */
function readLayout(raw: unknown, field: string): PromotionLayout {
  if (!isRecord(raw) || typeof raw.frameId !== 'string') throw contractError(field);
  const stickers = Array.isArray(raw.stickers)
    ? raw.stickers.filter(
        (s): s is StickerPlacement =>
          isRecord(s) &&
          typeof s.assetId === 'string' &&
          num(s.x) &&
          num(s.y) &&
          num(s.scale) &&
          num(s.rotation),
      )
    : [];
  const t = raw.tape;
  const tape =
    isRecord(t) && typeof t.assetId === 'string' && num(t.x) && num(t.y) && num(t.rotation)
      ? (t as TapePlacement)
      : null;
  return { v: 1, frameId: raw.frameId, stickers, tape };
}

function readSaved(raw: unknown, field: string): SavedPromotion | null {
  if (raw == null) return null;
  if (
    !isRecord(raw) ||
    typeof raw.promotionId !== 'string' ||
    typeof raw.issueDate !== 'string' ||
    typeof raw.body !== 'string'
  )
    throw contractError(field);
  return {
    promotionId: raw.promotionId,
    issueDate: raw.issueDate,
    body: raw.body,
    layout: readLayout(raw.layout, `${field}.layout`),
  };
}

export function readPromotionEditor(raw: unknown): PromotionEditor {
  if (!isRecord(raw) || !isRecord(raw.window) || typeof raw.window.open !== 'boolean')
    throw contractError('window');
  if (!num(raw.feeFish) || !num(raw.balance)) throw contractError('balance');
  const next = readSaved(raw.next, 'next');
  const rawNext = raw.next as Record<string, unknown> | null;
  return {
    window: raw.window as PromotionWindow,
    next: next && {
      ...next,
      appliedAt: String(rawNext?.appliedAt ?? ''),
      editable: rawNext?.editable === true,
    },
    latest: readSaved(raw.latest, 'latest'),
    feeFish: raw.feeFish as number,
    balance: raw.balance as number,
    privateIsland: raw.privateIsland === true,
  };
}

export async function getMagazineAssets(): Promise<MagazineAssets> {
  const raw = await request<unknown>('/me/magazine/assets');
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.frames) ||
    !Array.isArray(raw.stickers) ||
    !Array.isArray(raw.tapes)
  )
    throw contractError('assets');
  return raw as unknown as MagazineAssets;
}

export async function getPromotionEditor(islandId: string): Promise<PromotionEditor> {
  return readPromotionEditor(
    await request<unknown>(`/islands/${encodeURIComponent(islandId)}/promotions/editor`),
  );
}

/**
 * 홍보 신청 — 섬 통장에서 홍보비(60)를 뺀다. 응답 유실 재시도는 같은 `idempotencyKey` 로 보내야 두 번 빠지지 않는다
 * (키는 호출부가 같은 본문에 같은 키를 주는 intentKeyPool 로 만든다).
 */
export function applyPromotion(
  islandId: string,
  draft: PromotionDraft,
  idempotencyKey: string,
): Promise<PromotionApplied> {
  return request<PromotionApplied>(`/islands/${encodeURIComponent(islandId)}/promotions`, {
    method: 'POST',
    body: draft,
    idempotencyKey,
  });
}

/** 신청 창 안에서 고치기 — 같은 내용을 여러 번 보내도 결과가 같아 키가 없다. 창 밖이면 409 PROMOTION_LOCKED. */
export async function updatePromotion(
  islandId: string,
  promotionId: string,
  draft: PromotionDraft,
): Promise<PromotionUpdated> {
  const raw = await request<unknown>(
    `/islands/${encodeURIComponent(islandId)}/promotions/${encodeURIComponent(promotionId)}`,
    { method: 'PUT', body: draft },
  );
  const saved = readSaved(raw, 'promotion');
  if (!saved) throw contractError('promotion');
  return { ...saved, updatedAt: String((raw as Record<string, unknown>).updatedAt ?? '') };
}

/** 섬 소식 최신순(주민만 — 방문자는 403 이라 부르지 않는다). */
export async function getIslandNews(islandId: string, limit = 5): Promise<IslandNewsItem[]> {
  const raw = await request<unknown>(
    `/islands/${encodeURIComponent(islandId)}/news?limit=${limit}`,
  );
  if (!isRecord(raw) || !Array.isArray(raw.items)) throw contractError('items');
  return raw.items.filter(
    (n): n is IslandNewsItem =>
      isRecord(n) &&
      typeof n.id === 'string' &&
      typeof n.kind === 'string' &&
      typeof n.createdAt === 'string',
  );
}
