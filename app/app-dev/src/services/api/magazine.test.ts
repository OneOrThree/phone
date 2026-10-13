/**
 * 고양이 잡지 API(GROMO-2289) — 무접두 공개 경로, `{data}` 언랩. 서버가 아직 없어 구현계획 3장 계약 모양의 응답을 fetch
 * 스텁으로 흘려 본다(경로·메서드·멱등 키·본문, 응답 검증, 이상한 스티커만 걸러내기).
 */
import { ApiError } from '@/services/api/client';
import {
  applyPromotion,
  getIslandNews,
  getMagazineAssets,
  getPromotionEditor,
  updatePromotion,
} from '@/services/api/magazine';
import { clearSession, saveSession } from '@/services/api/session';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
function stub(status: number, data: unknown) {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(status < 300 ? { data } : data),
    } as unknown as Response;
  });
}
const path = (c: Call) => new URL(c.url).pathname + new URL(c.url).search;
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

const layout = {
  v: 1,
  frameId: 'mag.frame-scallop',
  stickers: [{ assetId: 'mag.fish', x: 0.5, y: 0.5, scale: 0.2, rotation: 0 }],
  tape: null,
};
const editorWire = {
  window: { open: true, issueDate: '2026-10-15', closesAt: 'a', opensAt: 'b' },
  next: null,
  latest: { promotionId: 'p0', issueDate: '2026-10-12', body: '안녕', layout },
  feeFish: 60,
  balance: 1234,
  privateIsland: false,
};

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('getPromotionEditor — GET /islands/{id}/promotions/editor 를 언랩하고 모양을 확인한다', async () => {
  stub(200, editorWire);
  const editor = await getPromotionEditor('i 1');
  expect(path(calls[0])).toBe('/islands/i%201/promotions/editor');
  expect(editor.latest?.layout.stickers).toHaveLength(1);
  expect(editor.next).toBeNull();
  expect(editor.privateIsland).toBe(false);
});

test('레이아웃의 이상한 스티커·테이프만 빼고 칸은 살린다', async () => {
  stub(200, {
    ...editorWire,
    latest: {
      ...editorWire.latest,
      layout: {
        ...layout,
        stickers: [...layout.stickers, { assetId: 'mag.star', x: 'a' }, null],
        tape: { assetId: 'mag.tape-pink' },
      },
    },
  });
  const editor = await getPromotionEditor('i1');
  expect(editor.latest?.layout.stickers).toHaveLength(1);
  expect(editor.latest?.layout.tape).toBeNull();
});

test('계약과 다른 응답(신청 창 없음)은 CLIENT_CONTRACT_ERROR', async () => {
  stub(200, { ...editorWire, window: null });
  await expect(getPromotionEditor('i1')).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_ERROR' });
});

test('applyPromotion — POST {body, layout} + Idempotency-Key', async () => {
  stub(201, {
    promotionId: 'p1',
    issueDate: '2026-10-15',
    feeFish: 60,
    balanceAfter: 1174,
    newsId: 'n',
  });
  const result = await applyPromotion('i1', { body: '안녕', layout } as any, 'key-1');
  expect(path(calls[0])).toBe('/islands/i1/promotions');
  expect(calls[0].init.method).toBe('POST');
  expect(header(calls[0], 'Idempotency-Key')).toBe('key-1');
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ body: '안녕', layout });
  expect(result.balanceAfter).toBe(1174);
});

test('updatePromotion — PUT, 키 없이 본문만', async () => {
  stub(200, { promotionId: 'p1', issueDate: '2026-10-15', body: '고침', layout, updatedAt: 'u' });
  const saved = await updatePromotion('i1', 'p1', { body: '고침', layout } as any);
  expect(path(calls[0])).toBe('/islands/i1/promotions/p1');
  expect(calls[0].init.method).toBe('PUT');
  expect(header(calls[0], 'Idempotency-Key')).toBeUndefined();
  expect(saved.body).toBe('고침');
});

test('오류 봉투는 코드 그대로 ApiError — 화면이 코드로 갈린다', async () => {
  stub(409, { error: { code: 'PROMOTION_LOCKED', message: '자정이 지났어요' } });
  const err = await updatePromotion('i1', 'p1', { body: 'x', layout } as any).catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.code).toBe('PROMOTION_LOCKED');
  expect(err.status).toBe(409);
});

test('getMagazineAssets · getIslandNews — 경로와 모양', async () => {
  stub(200, { frames: [], stickers: [], tapes: [] });
  await expect(getMagazineAssets()).resolves.toEqual({ frames: [], stickers: [], tapes: [] });
  expect(path(calls[0])).toBe('/me/magazine/assets');
  stub(200, {
    items: [
      { id: 'n1', kind: 'PROMOTION', body: '…', createdAt: '2026-10-14T00:00:00Z' },
      { id: 2, kind: 'X' },
    ],
  });
  const news = await getIslandNews('i1', 5);
  expect(path(calls[1])).toBe('/islands/i1/news?limit=5');
  expect(news.map((n) => n.id)).toEqual(['n1']);
});
