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
 */
import { ApiError, uuid } from './client';
import type {
  IslandNewsItem,
  MagazineAssets,
  PromotionApplied,
  PromotionDraft,
  PromotionEditor,
  PromotionUpdated,
  SavedPromotion,
} from './magazine';
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
type IslandStore = { promotions: Stored[]; balance: number | null; news: IslandNewsItem[] };
/** 섬마다 따로 — 데모에서 다른 소속 섬으로 바꾸면 그 섬의 홍보·통장·소식만 보인다. */
const islands = new Map<string, IslandStore>();
const storeOf = (islandId: string): IslandStore => {
  let store = islands.get(islandId);
  if (!store) islands.set(islandId, (store = { promotions: [], balance: null, news: [] }));
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

export const magazineMock = {
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
    _key: string,
    now = Date.now(),
  ): Promise<PromotionApplied> {
    await wait();
    const store = storeOf(islandId);
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
    return {
      promotionId,
      issueDate: w.issueDate,
      feeFish: 60,
      balanceAfter: store.balance!,
      newsId,
    };
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

/** 테스트에서 목업 서버를 처음 상태로 되돌린다. */
export function resetMagazineMock() {
  islands.clear();
}
