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
  expect(editor.window).toMatchObject({ open: true, issueDate: '2026-10-15' });
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
  expect(locked.window.open).toBe(false);
  expect(locked.next).toMatchObject({ promotionId: applied.promotionId, editable: false });
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
