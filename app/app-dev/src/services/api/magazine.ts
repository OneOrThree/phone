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
 *
 * 읽기(서버 `bfeat/GROMO-2289-magazine-publish` 의 business-api `Magazines` DTO 가 정본) — 게스트도 읽는다.
 *  - `GET  /me/magazine/today`                       오늘 호(가장 최근 호)와 내 받음 기록. 아직 호가 없으면 둘 다 null.
 *  - `GET  /me/magazine/issues`                      최근 7호, 최신순(잡지 꽂이).
 *  - `GET  /me/magazine/issues/{id}?cursor=&limit=`  호 한 페이지 — 편집부 지면은 첫 페이지에만, 칸은 신청 순서.
 *  - `PUT  /me/magazine/issues/{id}/receipt`         받음·나중에·읽음 `{ place, deferred?, opened? }` — true 만 적히고 되돌리지 않는다.
 *
 * 신고(서버 `bfeat/GROMO-2289-magazine-reports-funnel` 의 business-api `IslandPromotions` DTO 가 정본).
 *  - `POST /islands/{id}/promotions/{pid}/reports`   홍보 칸 신고 `{ reason }` — 소셜 계정만(게스트 403 SOCIAL_LOGIN_REQUIRED).
 *                                                   새 신고 201 · 이미 한 신고 200(같은 본문). 서로 다른 3명이면 서버가 칸을 숨긴다.
 */
import { ApiError, request } from './client';
import { CLIENT_CONTRACT_ERROR } from './home';
import type { ReportReason } from './safety';
import type { PromotionLayout, StickerPlacement, TapePlacement } from '@/screens/magazine/layout';

export type MagazineAsset = { assetId: string; bundle: 'free' | 'season'; owned: boolean };
export type MagazineAssets = {
  frames: MagazineAsset[];
  stickers: (MagazineAsset & { tab: string })[];
  tapes: MagazineAsset[];
};

/**
 * 신청 창 — issueDate 는 늘 KST 내일 호이고, opensAt~closesAt 은 그 호의 창(오늘 07:00 ~ 내일 00:00)이다. open 이 false 면
 * 00~07시라 opensAt(오늘 07시)에 열린다(서버 MagazineCalendar).
 */
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

export type MagazinePlace = 'SEA' | 'ISLAND';
/** 읽는 사람과 그 섬의 관계 — 주민이면 칸에 「우리 섬이에요」, 강퇴된 섬은 바다판 동그라미도 없다. */
export type MagazineRelation = 'NONE' | 'MEMBER' | 'KICKED';
/** 호 머리 — current 는 지금 나와 있는 호(다음 날 07시 전의 가장 최근 호)인가. */
export type MagazineIssue = {
  issueId: string;
  issueNo: number;
  issueDate: string;
  publishedAt: string;
  current: boolean;
};
/** 받음 기록 — 받은 곳·시각은 처음 값으로 고정, 나중에·읽음은 처음 true 로 온 시각. */
export type MagazineReceipt = {
  place: MagazinePlace;
  receivedAt: string;
  deferredAt: string | null;
  openedAt: string | null;
};
export type MagazineToday = { issue: MagazineIssue | null; receipt: MagazineReceipt | null };
export type MagazineIssueSummary = Omit<MagazineIssue, 'current'> & { opened: boolean };
export type MagazineIsland = {
  islandId: string;
  name: string;
  buildingCount: number;
  memberCount: number;
  maxMembers: number;
  averageFocusMinutesPerDay: number | null;
  relation: MagazineRelation;
};
/** 주간 랭킹 한 줄 — rank 는 비공개 섬을 뺀 순위(동점은 공동 순위). */
export type MagazineRanked = MagazineIsland & { rank: number };
/** 편집부 한마디 — EDITOR 면 운영 문구(body), TIP 이면 앱 번역 파일의 몽돌 팁 번호(tipNo). */
export type MagazineNote = { type: 'EDITOR' | 'TIP'; body: string | null; tipNo: number | null };
export type MagazineEditorial = {
  ranking: MagazineRanked[];
  newIslands: MagazineIsland[];
  note: MagazineNote;
};
/** 홍보 칸 — AdCell 이 그리는 값(섬 요약 + 글 + layout)에 홍보 id·관계를 더한 모양. */
export type MagazineCell = MagazineIsland & {
  promotionId: string;
  body: string;
  layout: PromotionLayout;
};
export type MagazineIssuePage = {
  issue: MagazineIssue;
  /** 첫 페이지에만 있다. */
  editorial: MagazineEditorial | null;
  cells: MagazineCell[];
  /** 다음 칸이 있으면 서명 커서, 끝이면 null. */
  nextCursor: string | null;
};
export type ReceiptUpdate = { place: MagazinePlace; deferred?: boolean; opened?: boolean };

const str = (v: unknown): v is string => typeof v === 'string';
const optionalTime = (v: unknown) => (str(v) ? v : null);

function readIssue(raw: unknown, field: string): MagazineIssue {
  if (
    !isRecord(raw) ||
    !str(raw.issueId) ||
    !num(raw.issueNo) ||
    !str(raw.issueDate) ||
    !str(raw.publishedAt) ||
    typeof raw.current !== 'boolean'
  )
    throw contractError(field);
  return {
    issueId: raw.issueId,
    issueNo: raw.issueNo as number,
    issueDate: raw.issueDate,
    publishedAt: raw.publishedAt,
    current: raw.current,
  };
}

function readReceipt(raw: unknown, field: string): MagazineReceipt {
  if (!isRecord(raw) || (raw.place !== 'SEA' && raw.place !== 'ISLAND') || !str(raw.receivedAt))
    throw contractError(field);
  return {
    place: raw.place,
    receivedAt: raw.receivedAt,
    deferredAt: optionalTime(raw.deferredAt),
    openedAt: optionalTime(raw.openedAt),
  };
}

/** 섬 한 장 — 모양이 어긋나면 null 이라 그 섬만 빠진다(한 섬 때문에 호 전체가 오류가 되지 않게). */
function readIsland(raw: unknown): MagazineIsland | null {
  if (
    !isRecord(raw) ||
    !str(raw.islandId) ||
    !str(raw.name) ||
    !num(raw.buildingCount) ||
    !num(raw.memberCount) ||
    !num(raw.maxMembers)
  )
    return null;
  return {
    islandId: raw.islandId,
    name: raw.name,
    buildingCount: raw.buildingCount as number,
    memberCount: raw.memberCount as number,
    maxMembers: raw.maxMembers as number,
    averageFocusMinutesPerDay: num(raw.averageFocusMinutesPerDay)
      ? (raw.averageFocusMinutesPerDay as number)
      : null,
    // 모르는 관계 값은 아무 표시도 없는 NONE 으로 본다
    relation: raw.relation === 'MEMBER' || raw.relation === 'KICKED' ? raw.relation : 'NONE',
  };
}

/** 홍보 칸 한 장 — 모양이 어긋나면 null(망원경 목록의 잡지 칸 미리보기도 이것으로 읽는다). */
export function readMagazineCell(raw: unknown): MagazineCell | null {
  const island = readIsland(raw);
  if (!island || !isRecord(raw) || !str(raw.promotionId) || !str(raw.body)) return null;
  try {
    return {
      ...island,
      promotionId: raw.promotionId,
      body: raw.body,
      layout: readLayout(raw.layout, 'layout'),
    };
  } catch {
    return null;
  }
}

/** 편집부 지면 — 모양이 어긋나면 편집부만 빼고(null) 칸은 그대로 보인다. */
function readEditorial(raw: unknown): MagazineEditorial | null {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.ranking) ||
    !Array.isArray(raw.newIslands) ||
    !isRecord(raw.note)
  )
    return null;
  // 한마디는 유형별 필수 값이 있어야 한다 — EDITOR 는 글, TIP 은 팁 번호. 모르는 유형·빠진 값으로 팁을 지어내지 않는다
  const note = raw.note;
  const editorNote = note.type === 'EDITOR' && str(note.body) && note.body.trim() !== '';
  const tipNote = note.type === 'TIP' && num(note.tipNo) && Number.isInteger(note.tipNo);
  if (!editorNote && !tipNote) return null;
  return {
    ranking: raw.ranking.flatMap((row) => {
      const island = readIsland(row);
      return island && isRecord(row) && num(row.rank)
        ? [{ ...island, rank: row.rank as number }]
        : [];
    }),
    newIslands: raw.newIslands.flatMap((card) => {
      const island = readIsland(card);
      return island ? [island] : [];
    }),
    note: editorNote
      ? { type: 'EDITOR', body: note.body as string, tipNo: null }
      : { type: 'TIP', body: null, tipNo: note.tipNo as number },
  };
}

export async function getMagazineToday(): Promise<MagazineToday> {
  const raw = await request<unknown>('/me/magazine/today');
  if (!isRecord(raw)) throw contractError('today');
  return {
    issue: raw.issue == null ? null : readIssue(raw.issue, 'issue'),
    receipt: raw.receipt == null ? null : readReceipt(raw.receipt, 'receipt'),
  };
}

/** 잡지 꽂이 — 최근 7호, 최신 호가 먼저. */
export async function getMagazineIssues(): Promise<MagazineIssueSummary[]> {
  const raw = await request<unknown>('/me/magazine/issues');
  if (!isRecord(raw) || !Array.isArray(raw.items)) throw contractError('items');
  // 모양이 어긋난 줄은 그 줄만 뺀다(칸·섬과 같은 원칙)
  return raw.items.flatMap((item) =>
    isRecord(item) &&
    str(item.issueId) &&
    num(item.issueNo) &&
    str(item.issueDate) &&
    str(item.publishedAt) &&
    typeof item.opened === 'boolean'
      ? [
          {
            issueId: item.issueId,
            issueNo: item.issueNo as number,
            issueDate: item.issueDate,
            publishedAt: item.publishedAt,
            opened: item.opened,
          },
        ]
      : [],
  );
}

/** 호 한 페이지 — 첫 페이지(cursor 없음)에만 편집부 지면이 온다. 7호 밖이면 404 MAGAZINE_ISSUE_NOT_FOUND. */
export async function getMagazineIssue(
  issueId: string,
  cursor: string | null = null,
  limit = 30,
): Promise<MagazineIssuePage> {
  const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const raw = await request<unknown>(`/me/magazine/issues/${encodeURIComponent(issueId)}?${query}`);
  if (!isRecord(raw) || !Array.isArray(raw.cells)) throw contractError('cells');
  return {
    issue: readIssue(raw.issue, 'issue'),
    editorial: readEditorial(raw.editorial),
    cells: raw.cells.flatMap((cell) => {
      const read = readMagazineCell(cell);
      return read ? [read] : [];
    }),
    // 빈 문자열도 끝으로 본다
    nextCursor: str(raw.nextCursor) && raw.nextCursor ? raw.nextCursor : null,
  };
}

/** 받음·나중에·읽음 — 서버가 허용하는 키(place·deferred·opened)만 보낸다. 몇 번 보내도 결과가 같아 키가 없다. */
export async function putMagazineReceipt(
  issueId: string,
  update: ReceiptUpdate,
): Promise<MagazineReceipt> {
  const body: ReceiptUpdate = { place: update.place };
  if (update.deferred) body.deferred = true;
  if (update.opened) body.opened = true;
  return readReceipt(
    await request<unknown>(`/me/magazine/issues/${encodeURIComponent(issueId)}/receipt`, {
      method: 'PUT',
      body,
    }),
    'receipt',
  );
}

/**
 * 홍보 칸 신고 — 이미 신고한 칸이면 서버가 200 으로 같은 본문을 준다(`created: false`). 같은 신고를 다시 보내도 늘지 않아
 * 멱등 키가 없다.
 */
export async function reportPromotion(
  islandId: string,
  promotionId: string,
  reason: ReportReason,
): Promise<{ created: boolean }> {
  let status = 0;
  const raw = await request<unknown>(
    `/islands/${encodeURIComponent(islandId)}/promotions/${encodeURIComponent(promotionId)}/reports`,
    { method: 'POST', body: { reason }, onStatus: (s) => (status = s) },
  );
  if (!isRecord(raw) || raw.reported !== true) throw contractError('reported');
  return { created: status === 201 };
}
