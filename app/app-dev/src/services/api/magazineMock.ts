/**
 * 목업 모드(?demo · ?review · EXPO_PUBLIC_DEMO)용 고양이 잡지 서버 흉내(GROMO-2289). `magazine.ts` 와 같은 함수 모양으로
 * 신청 창(07~24시 KST)·다음 호 홍보·홍보비 60·잔액·고치기 잠금·섬 소식을 메모리에 들고 계약의 오류 코드로 거절한다.
 * 서버 없이 쓰기 화면을 끝까지 돌려 보는 데만 쓴다 — 앱을 다시 켜면 비워진다.
 *
 * 시뮬레이터 QA 는 `EXPO_PUBLIC_MAGAZINE_MOCK` 에 쉼표로 상황을 준다(Metro 를 이 값으로 띄운다).
 *  - `open` · `closed`  지금 시각 대신 신청 창을 연 것·닫힌 것(00~07시)으로 본다
 *  - `applied`  이번 호에 이미 낸 홍보가 있다(고치기 모드 — closed 와 같이 주면 자정 뒤 읽기 전용)
 *  - `latest`   지난번에 실은 칸이 있다(화면이 그 칸으로 열린다)
 *  - `poor` 섬 통장 30마리 · `private` 비공개 섬 · `guest` 게스트 섬장(403 SOCIAL_LOGIN_REQUIRED)
 *  - `member`   섬장이 아닌 주민으로 본다(쓰기 화면은 섬장만 · 주민 소식 토스트는 주민에게만)
 *  - `news`     방금 섬장이 홍보한 섬 소식이 있다
 *
 * 잡지 읽기(오늘 호·꽂이·호 펼치기·받음)는 최근 7호(13~19호)를 메모리에 둔다. 기본은 오늘 호를 이미 받았고 아직 안 읽은 상태다.
 *  - `deliver`  오늘 호를 아직 받지 않았다(섬 홈에 펠리컨 배달이 뜬다)
 *  - `opened`   오늘 호를 이미 읽었다(빨간 점 없음)
 *  - `noissue`  아직 낸 호가 없다 · `emptyissue` 오늘 호에 홍보 칸·랭킹·새 섬이 없다
 *  - `paged`    오늘 호 칸 8개를 4개씩 커서로 나눠 준다
 *
 * 신고(칸 길게 누르기)는 칸마다 처음은 새 신고, 두 번째부터 「이미 신고」다. `guest` 면 403 SOCIAL_LOGIN_REQUIRED.
 * 회관 홍보 기록판은 지난 홍보 6건(발행 전·실림·숨김·안 실림·내려감)을 준다.
 *  - `norecords` 기록이 없다 · `recordsfail` 기록판 읽기가 실패한다
 *  - `telescope` 목업에서도 망원경 목록을 보인다(잡지에서 찜한 섬 — 칸 미리보기 있음·없음 — 과 전망대 찜·무작위 섬)
 */
import { ApiError, uuid } from './client';
import type {
  IslandNewsItem,
  MagazineAssets,
  MagazineCell,
  MagazineEditorial,
  MagazineIssue,
  MagazineIssuePage,
  MagazineIssueSummary,
  MagazineReceipt,
  MagazineToday,
  ReceiptUpdate,
  PromotionApplied,
  PromotionDraft,
  PromotionEditor,
  PromotionRecord,
  PromotionUpdated,
  SavedPromotion,
} from './magazine';
import type { Telescope } from './telescope';
import { isMockMode } from '@/services/demoMode';
import { MAGAZINE_FRAMES, MAGAZINE_STICKERS, MAGAZINE_TAPES } from '@/constants/magazineAssets';

export const mockFlags = (): Set<string> =>
  new Set(
    (process.env.EXPO_PUBLIC_MAGAZINE_MOCK ?? '')
      .split(',')
      .map((flag: string) => flag.trim())
      .filter(Boolean),
  );

const KST = 9 * 3600_000;
const DAY = 86_400_000;
const kstDay = (now: number, plus = 0) =>
  new Date(now + KST + plus * DAY).toISOString().slice(0, 10);
/** KST 날짜 d 의 hh:00 을 UTC ISO 로 */
const kstAt = (day: string, hour: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - KST + hour * 3600_000).toISOString();

type Stored = SavedPromotion & { appliedAt: string };
type IslandStore = {
  promotions: Stored[];
  balance: number | null;
  news: IslandNewsItem[];
  /** 멱등 키 → (본문, 첫 응답) — 같은 키 재시도는 첫 응답 그대로, 다른 본문이면 409 IDEMPOTENCY_KEY_REUSED(서버와 같다) */
  applied: Map<string, { draft: string; response: PromotionApplied }>;
};
/** 섬마다 따로 — 데모에서 다른 소속 섬으로 바꾸면 그 섬의 홍보·통장·소식만 보인다. */
const islands = new Map<string, IslandStore>();
const storeOf = (islandId: string): IslandStore => {
  let store = islands.get(islandId);
  if (!store)
    islands.set(
      islandId,
      (store = { promotions: [], balance: null, news: [], applied: new Map() }),
    );
  return store;
};
const wait = () => new Promise((resolve) => setTimeout(resolve, 250));
const reject = (code: string, status: number, message: string) => {
  throw new ApiError(code, message, status);
};

/**
 * 서버 MagazineCalendar 와 같은 셈. 신청 창이 향하는 호(window.issueDate)는 늘 KST 내일이고, 그 호의 창은 오늘 07:00~내일 00:00 이다
 * (00~07시에는 아직 안 열렸고 07시에 열린다). 아직 발행 안 된 가장 가까운 호(upcoming)는 열려 있으면 내일 호, 00~07시면 오늘 07시 호다.
 */
function windowAt(now: number) {
  const flags = mockFlags();
  const hour = new Date(now + KST).getUTCHours();
  const open = flags.has('open') ? true : flags.has('closed') ? false : hour >= 7;
  const issueDate = kstDay(now, 1);
  return {
    open,
    issueDate,
    opensAt: kstAt(kstDay(now), 7),
    closesAt: kstAt(issueDate, 0),
    upcoming: open ? issueDate : kstDay(now),
  };
}

function seed(store: IslandStore, now: number) {
  const flags = mockFlags();
  if (store.balance == null) store.balance = flags.has('poor') ? 30 : 1240;
  if (!store.promotions.length && (flags.has('applied') || flags.has('latest'))) {
    const w = windowAt(now);
    store.promotions.push({
      promotionId: 'mock-promotion',
      issueDate: flags.has('applied') ? w.upcoming : kstDay(now, -2),
      appliedAt: new Date(now - 3600_000).toISOString(),
      body: '같이 집중할 새 친구를 기다려요! 도서관도 놀러 와요',
      layout: {
        v: 1,
        frameId: 'mag.frame-catear',
        stickers: [
          { assetId: 'mag.cat-ginger-fish', x: 0.85, y: 0.2, scale: 0.2, rotation: -8 },
          { assetId: 'mag.heart', x: 0.9, y: 0.82, scale: 0.08, rotation: 10 },
        ],
        tape: null,
      },
    });
  }
  if (flags.has('news') && !store.news.length)
    store.news.push({
      id: `mock-news-${now}`, // 목업은 켤 때마다 새 소식 — 기기에 「본 소식」이 남아도 다시 보인다
      kind: 'PROMOTION',
      body: '섬장이 오늘 잡지 홍보에 60마리를 썼어요',
      createdAt: new Date(now - 300_000).toISOString(),
    });
}

const HOUR = 3600_000;
const ISSUES = 7;
const TODAY_NO = 19;
// 07시 전에는 어제 07시 호가 오늘 호다
const issueOf = (no: number, now: number): MagazineIssue => {
  const date = kstDay(now - 7 * HOUR, no - TODAY_NO);
  return {
    issueId: `mock-issue-${no}`,
    issueNo: no,
    issueDate: date,
    publishedAt: kstAt(date, 7),
    current: no === TODAY_NO,
  };
};
const card = (
  name: string,
  buildingCount: number,
  memberCount: number,
  averageFocusMinutesPerDay: number | null,
  relation: MagazineCell['relation'] = 'NONE',
) => ({
  islandId: `mock-island-${name}`,
  name,
  buildingCount,
  memberCount,
  maxMembers: 15,
  averageFocusMinutesPerDay,
  relation,
});
const sticker = (assetId: string, x: number, y: number, scale: number, rotation = 0) => ({
  assetId,
  x,
  y,
  scale,
  rotation,
});
// prettier-ignore
const MOCK_CELLS: MagazineCell[] = [
  { ...card('소다', 7, 8, 130, 'MEMBER'), promotionId: 'mock-cell-1', body: '같이 집중할 새 친구를 기다려요!',
    layout: { v: 1, frameId: 'mag.frame-cloud', stickers: [sticker('mag.cat-ginger-fish', 0.86, 0.2, 0.18, -6), sticker('mag.heart', 0.84, 0.74, 0.08, 12)], tape: null } },
  { ...card('별고래섬', 5, 12, 185), promotionId: 'mock-cell-2', body: '밤에 같이 공부할 고양이 모여라~',
    layout: { v: 1, frameId: 'mag.frame-ticket', stickers: [sticker('mag.cat-black-book', 0.82, 0.18, 0.17), sticker('mag.star', 0.8, 0.78, 0.07)], tape: null } },
  { ...card('노을', 3, 5, 100), promotionId: 'mock-cell-3', body: '노을을 보면서 천천히, 꾸준히 해요',
    layout: { v: 1, frameId: 'mag.frame-grid', stickers: [sticker('mag.cat-calico-wave', 0.86, 0.17, 0.16)], tape: { assetId: 'mag.tape-yellowcheck', x: 0.4, y: 0, rotation: -8 } } },
  { ...card('달빛섬', 2, 2, null, 'KICKED'), promotionId: 'mock-cell-4', body: '누구나 환영! 조용히 책 읽는 섬이에요',
    layout: { v: 1, frameId: 'mag.frame-notebook', stickers: [sticker('mag.moon', 0.86, 0.22, 0.12), sticker('mag.book', 0.82, 0.74, 0.1, 8)], tape: null } },
  { ...card('모래톱', 1, 1, 45), promotionId: 'mock-cell-5', body: '아침 7시 집중 메이트 구해요',
    layout: { v: 1, frameId: 'mag.frame-wave', stickers: [sticker('mag.palm-island', 0.85, 0.24, 0.16), sticker('mag.shell', 0.9, 0.76, 0.07)], tape: null } },
  { ...card('조약돌섬', 4, 6, 75), promotionId: 'mock-cell-6', body: '모닥불 앞에서 같이 공부해요',
    layout: { v: 1, frameId: 'mag.frame-woodsign', stickers: [sticker('mag.campfire', 0.86, 0.3, 0.14)], tape: null } },
  { ...card('구름섬', 6, 9, 150), promotionId: 'mock-cell-7', body: '시험 기간 같이 버텨요 화이팅',
    layout: { v: 1, frameId: 'mag.frame-polaroid', stickers: [sticker('mag.cat-gray-cheer', 0.84, 0.22, 0.17)], tape: { assetId: 'mag.tape-mint', x: 0.5, y: 0, rotation: 4 } } },
  { ...card('등대섬', 2, 3, 60), promotionId: 'mock-cell-8', body: '등대 불빛처럼 오래오래 같이 가요',
    layout: { v: 1, frameId: 'mag.frame-envelope', stickers: [sticker('mag.lighthouse', 0.86, 0.3, 0.13)], tape: null } },
];
const MOCK_EDITORIAL: MagazineEditorial = {
  ranking: [
    { ...card('별고래섬', 5, 12, 185), rank: 1 },
    { ...card('소다', 7, 8, 130, 'MEMBER'), rank: 2 },
    { ...card('조약돌섬', 4, 6, 115), rank: 3 },
  ],
  newIslands: [card('달빛섬', 1, 2, null), card('모래톱', 0, 1, null)],
  note: { type: 'TIP', body: null, tipNo: 0 },
};

/** 받음 기록(issueId → 기록). 처음 읽을 때 플래그대로 채운다. */
const receipts = new Map<string, MagazineReceipt>();
function seedReceipts(now: number) {
  if (receipts.size) return;
  const flags = mockFlags();
  for (let no = TODAY_NO - ISSUES + 1; no <= TODAY_NO; no++) {
    const issue = issueOf(no, now);
    const today = no === TODAY_NO;
    if (today && flags.has('deliver')) continue;
    // 지난 호는 하나 걸러 읽음
    const opened = today ? flags.has('opened') : no % 2 === 0;
    receipts.set(issue.issueId, {
      place: 'ISLAND',
      receivedAt: issue.publishedAt,
      deferredAt: null,
      openedAt: opened ? issue.publishedAt : null,
    });
  }
}
const mockIssues = (now: number) =>
  mockFlags().has('noissue')
    ? []
    : Array.from({ length: ISSUES }, (_, i) => issueOf(TODAY_NO - i, now));
const cellsOf = (no: number) =>
  mockFlags().has('emptyissue') && no === TODAY_NO
    ? []
    : no === TODAY_NO
      ? MOCK_CELLS.slice(0, mockFlags().has('paged') ? 8 : 5)
      : MOCK_CELLS.slice(TODAY_NO - no, TODAY_NO - no + 1 + (no % 3));

const magazineReaderMock = {
  async getMagazineToday(now = Date.now()): Promise<MagazineToday> {
    await wait();
    seedReceipts(now);
    const issue = mockIssues(now)[0] ?? null;
    return { issue, receipt: (issue && receipts.get(issue.issueId)) ?? null };
  },

  async getMagazineIssues(now = Date.now()): Promise<MagazineIssueSummary[]> {
    await wait();
    seedReceipts(now);
    return mockIssues(now).map(({ current: _current, ...issue }) => ({
      ...issue,
      opened: !!receipts.get(issue.issueId)?.openedAt,
    }));
  },

  async getMagazineIssue(
    issueId: string,
    cursor: string | null = null,
    limit = 30,
    now = Date.now(),
  ): Promise<MagazineIssuePage> {
    await wait();
    const issue = mockIssues(now).find((i) => i.issueId === issueId);
    if (!issue) return reject('MAGAZINE_ISSUE_NOT_FOUND', 404, '잡지 호를 찾을 수 없어요');
    const all = cellsOf(issue.issueNo);
    const size = mockFlags().has('paged') ? 4 : limit;
    const from = cursor ? Number(cursor) : 0;
    const empty = mockFlags().has('emptyissue') && issue.current;
    return {
      issue,
      editorial: cursor
        ? null
        : empty
          ? {
              ranking: [],
              newIslands: [],
              note: {
                type: 'EDITOR',
                body: '오늘은 조용한 바다예요. 내일 또 만나요!',
                tipNo: null,
              },
            }
          : { ...MOCK_EDITORIAL, note: { ...MOCK_EDITORIAL.note, tipNo: issue.issueNo % 14 } },
      cells: all.slice(from, from + size),
      nextCursor: from + size < all.length ? String(from + size) : null,
    };
  },

  async putMagazineReceipt(
    issueId: string,
    update: ReceiptUpdate,
    now = Date.now(),
  ): Promise<MagazineReceipt> {
    await wait();
    seedReceipts(now);
    if (!mockIssues(now).some((i) => i.issueId === issueId))
      return reject('MAGAZINE_ISSUE_NOT_FOUND', 404, '잡지 호를 찾을 수 없어요');
    const at = new Date(now).toISOString();
    const prev = receipts.get(issueId) ?? {
      place: update.place,
      receivedAt: at,
      deferredAt: null,
      openedAt: null,
    };
    const next = {
      ...prev,
      deferredAt: prev.deferredAt ?? (update.deferred ? at : null),
      openedAt: prev.openedAt ?? (update.opened ? at : null),
    };
    receipts.set(issueId, next);
    return next;
  },
};
/** 이 기기에서 신고한 칸 — 같은 칸 두 번째 신고는 서버처럼 「이미 신고」(created: false)다. */
const reported = new Set<string>();

/** 지난 홍보 기록 — 상태마다 하나씩, 칸 꾸미기는 잡지 칸 목업에서 빌린다. */
function mockRecords(now: number): PromotionRecord[] {
  const day = (plus: number) => kstDay(now - 7 * HOUR, plus);
  const row = (
    i: number,
    issueDate: string,
    issueNo: number | null,
    status: PromotionRecord['status'],
    pinned = 0,
    arrived = 0,
    joined = 0,
  ): PromotionRecord => ({
    promotionId: `mock-record-${i}`,
    issueDate,
    issueNo,
    body: MOCK_CELLS[i].body,
    status,
    pinned,
    arrived,
    joined,
    layout: MOCK_CELLS[i].layout,
  });
  return [
    row(0, day(1), null, 'SCHEDULED'),
    row(1, day(0), TODAY_NO, 'PUBLISHED', 12, 4, 1),
    row(2, day(-1), TODAY_NO - 1, 'HIDDEN', 3, 0, 0),
    row(3, day(-2), null, 'SKIPPED'),
    row(4, day(-3), TODAY_NO - 3, 'PUBLISHED', 5, 2, 0),
    row(5, day(-5), TODAY_NO - 5, 'REMOVED', 1, 0, 0),
  ];
}

export const magazineMock = {
  ...magazineReaderMock,

  async reportPromotion(
    _islandId: string,
    promotionId: string,
    _reason: string,
  ): Promise<{ created: boolean }> {
    await wait();
    if (mockFlags().has('guest'))
      reject('SOCIAL_LOGIN_REQUIRED', 403, '소셜 로그인 후 이용할 수 있어요.');
    const created = !reported.has(promotionId);
    reported.add(promotionId);
    return { created };
  },

  async getPromotionRecords(
    _islandId: string,
    _limit = 20,
    now = Date.now(),
  ): Promise<PromotionRecord[]> {
    await wait();
    const flags = mockFlags();
    if (flags.has('recordsfail'))
      reject('CLIENT_NETWORK_ERROR', 0, '네트워크에 연결할 수 없어요. 연결을 확인해 주세요.');
    return flags.has('norecords') ? [] : mockRecords(now);
  },

  async getMagazineAssets(): Promise<MagazineAssets> {
    await wait();
    const free = (assetId: string) => ({ assetId, bundle: 'free' as const, owned: true });
    return {
      frames: Object.keys(MAGAZINE_FRAMES).map(free),
      stickers: Object.entries(MAGAZINE_STICKERS).map(([id, s]) => ({ ...free(id), tab: s.tab })),
      tapes: Object.keys(MAGAZINE_TAPES).map(free),
    };
  },

  async getPromotionEditor(islandId: string, now = Date.now()): Promise<PromotionEditor> {
    await wait();
    const store = storeOf(islandId);
    const flags = mockFlags();
    if (flags.has('guest'))
      reject('SOCIAL_LOGIN_REQUIRED', 403, '소셜 로그인 후 이용할 수 있어요.');
    seed(store, now);
    const w = windowAt(now);
    const next = store.promotions.find((p) => p.issueDate === w.upcoming) ?? null;
    const latest =
      [...store.promotions]
        .filter((p) => p !== next)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0] ?? null;
    return {
      window: { open: w.open, issueDate: w.issueDate, opensAt: w.opensAt, closesAt: w.closesAt },
      next: next && { ...next, editable: w.open && next.issueDate === w.issueDate },
      latest,
      feeFish: 60,
      balance: store.balance!,
      privateIsland: flags.has('private'),
    };
  },

  async applyPromotion(
    islandId: string,
    draft: PromotionDraft,
    key: string,
    now = Date.now(),
  ): Promise<PromotionApplied> {
    await wait();
    const store = storeOf(islandId);
    const replay = store.applied.get(key);
    if (replay) {
      if (replay.draft !== JSON.stringify(draft))
        reject('IDEMPOTENCY_KEY_REUSED', 409, '다른 요청에 사용한 명령 키입니다.');
      return replay.response;
    }
    seed(store, now);
    const w = windowAt(now);
    if (mockFlags().has('private'))
      reject('PROMOTION_PRIVATE_ISLAND', 409, '비공개 섬은 잡지에 실을 수 없어요.');
    if (!w.open) reject('PROMOTION_WINDOW_CLOSED', 409, '지금은 신청할 수 없어요.');
    if (store.promotions.some((p) => p.issueDate === w.issueDate))
      reject('PROMOTION_ALREADY_REQUESTED_TODAY', 409, '오늘은 이미 잡지 홍보를 신청했어요');
    if (store.balance! < 60) reject('INSUFFICIENT_FUNDS', 409, '섬 통장 물고기가 모자라요.');
    store.balance! -= 60;
    const promotionId = uuid();
    store.promotions.push({
      ...draft,
      promotionId,
      issueDate: w.issueDate,
      appliedAt: new Date(now).toISOString(),
    });
    const newsId = uuid();
    store.news.unshift({
      id: newsId,
      kind: 'PROMOTION',
      body: '섬장이 오늘 잡지 홍보에 60마리를 썼어요',
      createdAt: new Date(now).toISOString(),
    });
    const response = {
      promotionId,
      issueDate: w.issueDate,
      feeFish: 60,
      balanceAfter: store.balance!,
      newsId,
    };
    store.applied.set(key, { draft: JSON.stringify(draft), response });
    return response;
  },

  async updatePromotion(
    islandId: string,
    promotionId: string,
    draft: PromotionDraft,
    now = Date.now(),
  ): Promise<PromotionUpdated> {
    await wait();
    const store = storeOf(islandId);
    const w = windowAt(now);
    const saved = store.promotions.find((p) => p.promotionId === promotionId);
    if (!saved) return reject('PROMOTION_NOT_FOUND', 404, '홍보를 찾지 못했어요.');
    if (!w.open || saved.issueDate !== w.issueDate)
      reject('PROMOTION_LOCKED', 409, '자정이 지나 고칠 수 없어요.');
    Object.assign(saved, draft);
    return { ...saved, updatedAt: new Date(now).toISOString() };
  },

  async getIslandNews(islandId: string, limit = 5, now = Date.now()): Promise<IslandNewsItem[]> {
    await wait();
    const store = storeOf(islandId);
    seed(store, now);
    return store.news.slice(0, limit);
  },
};

/** `telescope` 플래그일 때만 쓰는 망원경 목록 — 잡지 찜 리본·칸 미리보기(SCOPE-09)를 서버 없이 본다. */
export const isTelescopeMock = () => isMockMode() && mockFlags().has('telescope');
export async function getTelescopeMock(now = Date.now()): Promise<Telescope> {
  await wait();
  const item = (
    c: MagazineCell,
    slot: Telescope['items'][number]['slot'],
    extra: Partial<Telescope['items'][number]> = {},
  ): Telescope['items'][number] => ({
    islandId: c.islandId,
    name: c.name,
    intro: c.body,
    memberCount: c.memberCount,
    maxMembers: c.maxMembers,
    approvalRequired: false,
    membershipStatus: slot === 'joined' ? 'active' : 'none',
    slot,
    sailingMinutes: 15,
    averageFocusMinutesPerDay: c.averageFocusMinutesPerDay,
    full: false,
    arrivedBefore: slot === 'joined',
    magazineCell: null,
    ...extra,
  });
  const pinnedAt = new Date(now - HOUR).toISOString();
  const magazine = { pinnedFrom: 'magazine' as const, pinnedAt };
  return {
    bucketStart: new Date(now - (now % HOUR)).toISOString(),
    nextRefreshMinutes: 30,
    items: [
      item(MOCK_CELLS[0], 'joined'),
      item(MOCK_CELLS[1], 'pinned', { ...magazine, magazineCell: MOCK_CELLS[1] }),
      // 편집부 칸에서 넣었거나 칸이 숨겨진 섬 — 미리보기는 자리표시 그대로
      item(MOCK_CELLS[2], 'pinned', magazine),
      item(MOCK_CELLS[4], 'pinned', { pinnedFrom: 'observatory', pinnedAt }),
      item(MOCK_CELLS[5], 'random'),
    ],
  };
}

/** 테스트에서 목업 서버를 처음 상태로 되돌린다. */
export function resetMagazineMock() {
  islands.clear();
  receipts.clear();
  reported.clear();
}
