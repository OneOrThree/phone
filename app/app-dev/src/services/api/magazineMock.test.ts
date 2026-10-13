// 목업 잡지 서버(GROMO-2289) — 시뮬레이터 QA 가 믿는 규칙: 07~24시 신청 창 · 하루 한 번 · 홍보비 60 · 자정 뒤 고치기 잠금.
import { magazineMock, resetMagazineMock } from './magazineMock';

const layout = { v: 1 as const, frameId: 'mag.frame-scallop', stickers: [], tape: null };
const at = (kst: string) => Date.parse(`${kst}+09:00`);

beforeEach(() => {
  resetMagazineMock();
  delete process.env.EXPO_PUBLIC_MAGAZINE_MOCK;
  jest.useFakeTimers({ advanceTimers: true });
});
afterEach(() => jest.useRealTimers());

it('07~24시는 내일 호에 신청 · 같은 호 두 번은 거절 · 잔액에서 60', async () => {
  const now = at('2026-10-14T10:00:00');
  const editor = await magazineMock.getPromotionEditor('i', now);
  // 서버 MagazineCalendar 와 같은 값 — 창이 향하는 호는 내일, 그 호의 창은 오늘 07:00 ~ 내일 00:00(KST)
  expect(editor.window).toEqual({
    open: true,
    issueDate: '2026-10-15',
    opensAt: '2026-10-13T22:00:00.000Z',
    closesAt: '2026-10-14T15:00:00.000Z',
  });
  const applied = await magazineMock.applyPromotion('i', { body: '안녕', layout }, 'k', now);
  expect(applied.balanceAfter).toBe(editor.balance - 60);
  await expect(
    magazineMock.applyPromotion('i', { body: '또', layout }, 'k2', now),
  ).rejects.toMatchObject({
    code: 'PROMOTION_ALREADY_REQUESTED_TODAY',
  });
  // 같은 날 고치기는 되고, 자정이 지나면 잠긴다
  await expect(
    magazineMock.updatePromotion('i', applied.promotionId, { body: '고침', layout }, now),
  ).resolves.toMatchObject({ body: '고침' });
  const night = at('2026-10-15T00:30:00');
  const locked = await magazineMock.getPromotionEditor('i', night);
  // 00~07시: 창은 다음 날 호를 향하고 오늘 07시에 열린다, next 는 오늘 07시에 나갈 호(읽기 전용)
  expect(locked.window).toEqual({
    open: false,
    issueDate: '2026-10-16',
    opensAt: '2026-10-14T22:00:00.000Z',
    closesAt: '2026-10-15T15:00:00.000Z',
  });
  expect(locked.next).toMatchObject({
    promotionId: applied.promotionId,
    issueDate: '2026-10-15',
    editable: false,
  });
  await expect(
    magazineMock.updatePromotion('i', applied.promotionId, { body: '밤', layout }, night),
  ).rejects.toMatchObject({ code: 'PROMOTION_LOCKED' });
  await expect(
    magazineMock.applyPromotion('i', { body: '밤', layout }, 'k3', night),
  ).rejects.toMatchObject({
    code: 'PROMOTION_WINDOW_CLOSED',
  });
});

it('상황 깃발 — guest 는 403, poor 는 잔액 30, private 는 신청 거절', async () => {
  process.env.EXPO_PUBLIC_MAGAZINE_MOCK = 'guest';
  await expect(magazineMock.getPromotionEditor('i')).rejects.toMatchObject({ status: 403 });
  resetMagazineMock();
  process.env.EXPO_PUBLIC_MAGAZINE_MOCK = 'open,poor,private';
  const editor = await magazineMock.getPromotionEditor('i');
  expect(editor).toMatchObject({ balance: 30, privateIsland: true });
  await expect(magazineMock.applyPromotion('i', { body: 'x', layout }, 'k')).rejects.toMatchObject({
    code: 'PROMOTION_PRIVATE_ISLAND',
  });
});

describe('잡지 읽기 목업', () => {
  const now = at('2026-10-14T10:00:00');

  it('기본은 오늘 호(19호)를 받았고 아직 안 읽었다 — 07시 전에는 어제 호가 오늘 호', async () => {
    const today = await magazineMock.getMagazineToday(now);
    expect(today.issue).toMatchObject({ issueNo: 19, issueDate: '2026-10-14', current: true });
    expect(today.receipt).toMatchObject({ place: 'ISLAND', openedAt: null });
    resetMagazineMock();
    const early = await magazineMock.getMagazineToday(at('2026-10-14T06:59:00'));
    expect(early.issue?.issueDate).toBe('2026-10-13');
  });

  it('deliver 면 아직 받지 않았고, 받음·읽음을 보내면 처음 시각이 남는다', async () => {
    process.env.EXPO_PUBLIC_MAGAZINE_MOCK = 'deliver';
    const today = await magazineMock.getMagazineToday(now);
    expect(today.receipt).toBeNull();
    const id = today.issue!.issueId;
    const got = await magazineMock.putMagazineReceipt(id, { place: 'ISLAND' }, now);
    expect(got).toMatchObject({ place: 'ISLAND', deferredAt: null, openedAt: null });
    const read = await magazineMock.putMagazineReceipt(
      id,
      { place: 'SEA', opened: true },
      now + 60_000,
    );
    // 받은 곳은 처음 값(ISLAND) 그대로
    expect(read).toMatchObject({ place: 'ISLAND', openedAt: new Date(now + 60_000).toISOString() });
  });

  it('꽂이는 최근 7호 최신순 · 7호 밖은 404', async () => {
    const items = await magazineMock.getMagazineIssues(now);
    expect(items.map((i) => i.issueNo)).toEqual([19, 18, 17, 16, 15, 14, 13]);
    await expect(
      magazineMock.getMagazineIssue('mock-issue-12', null, 30, now),
    ).rejects.toMatchObject({ code: 'MAGAZINE_ISSUE_NOT_FOUND' });
  });

  it('paged 면 칸 8개를 4개씩 커서로 — 편집부 지면은 첫 페이지에만', async () => {
    process.env.EXPO_PUBLIC_MAGAZINE_MOCK = 'paged';
    const first = await magazineMock.getMagazineIssue('mock-issue-19', null, 30, now);
    expect(first.editorial).not.toBeNull();
    expect(first.cells).toHaveLength(4);
    const second = await magazineMock.getMagazineIssue('mock-issue-19', first.nextCursor, 30, now);
    expect(second.editorial).toBeNull();
    expect(second.cells).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
  });
});

it('섬마다 홍보·통장·소식이 따로다 — 다른 소속 섬으로 바꿔도 앞 섬의 홍보가 보이지 않는다', async () => {
  const now = at('2026-10-14T10:00:00');
  await magazineMock.applyPromotion('a', { body: '에이 섬', layout }, 'k', now);
  const a = await magazineMock.getPromotionEditor('a', now);
  const b = await magazineMock.getPromotionEditor('b', now);
  expect(a.next?.body).toBe('에이 섬');
  expect(b.next).toBeNull();
  expect(b.balance).toBe(a.balance + 60);
  expect(await magazineMock.getIslandNews('b', 5, now)).toEqual([]);
  // 같은 날 다른 섬은 따로 신청할 수 있다
  await expect(
    magazineMock.applyPromotion('b', { body: '비 섬', layout }, 'k2', now),
  ).resolves.toMatchObject({ balanceAfter: b.balance - 60 });
});
