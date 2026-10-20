/**
 * 고양이 잡지 API(GROMO-2289) — 무접두 공개 경로, `{data}` 언랩. 서버가 아직 없어 구현계획 3장 계약 모양의 응답을 fetch
 * 스텁으로 흘려 본다(경로·메서드·멱등 키·본문, 응답 검증, 이상한 스티커만 걸러내기).
 */
import { ApiError } from '@/services/api/client';
import {
  applyPromotion,
  getIslandNews,
  getMagazineAssets,
  getMagazineIssue,
  getMagazineIssues,
  getMagazineToday,
  getPromotionEditor,
  putMagazineReceipt,
  reportPromotion,
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

// ── 잡지 읽기(서버 publish 브랜치 business-api Magazines DTO) ──
const issueWire = {
  issueId: 'iss-19',
  issueNo: 19,
  issueDate: '2026-10-14',
  publishedAt: '2026-10-13T22:00:00Z',
  current: true,
};
const island = (name: string, relation = 'NONE') => ({
  islandId: `is-${name}`,
  name,
  buildingCount: 3,
  memberCount: 4,
  maxMembers: 15,
  averageFocusMinutesPerDay: null,
  relation,
});

describe('잡지 읽기', () => {
  test('오늘 호 — 아직 호가 없으면 issue·receipt 둘 다 null', async () => {
    stub(200, { issue: null, receipt: null });
    await expect(getMagazineToday()).resolves.toEqual({ issue: null, receipt: null });
    expect(path(calls[0])).toBe('/me/magazine/today');
  });

  test('오늘 호와 받음 기록을 읽는다 — 아직 안 읽었으면 openedAt null', async () => {
    const receipt = {
      place: 'ISLAND',
      receivedAt: '2026-10-13T23:00:00Z',
      deferredAt: null,
      openedAt: null,
    };
    stub(200, { issue: issueWire, receipt });
    await expect(getMagazineToday()).resolves.toEqual({ issue: issueWire, receipt });
  });

  test('호 머리가 계약과 다르면 오류로 보낸다', async () => {
    stub(200, { issue: { ...issueWire, issueNo: '19' }, receipt: null });
    await expect(getMagazineToday()).rejects.toBeInstanceOf(ApiError);
  });

  test('잡지 꽂이 — 최근 7호를 그대로 읽는다', async () => {
    const { current: _current, ...head } = issueWire;
    stub(200, { items: [{ ...head, opened: true }] });
    await expect(getMagazineIssues()).resolves.toEqual([{ ...head, opened: true }]);
    expect(path(calls[0])).toBe('/me/magazine/issues');
  });

  test('호 펼치기 — 첫 페이지는 limit 만, 다음 페이지는 커서를 붙인다', async () => {
    stub(200, {
      issue: issueWire,
      editorial: {
        ranking: [{ ...island('별고래섬'), rank: 1, averageFocusMinutesPerDay: 185 }],
        newIslands: [island('달빛')],
        note: { type: 'TIP', body: null, tipNo: 5 },
      },
      cells: [
        { ...island('소다', 'MEMBER'), promotionId: 'p1', body: '안녕', layout },
        // 모양이 어긋난 칸은 그 칸만 빠진다
        { ...island('깨진섬'), promotionId: 'p2', body: '안녕', layout: { stickers: [] } },
      ],
      nextCursor: 'c+1',
    });
    const page = await getMagazineIssue('iss 19');
    expect(path(calls[0])).toBe('/me/magazine/issues/iss%2019?limit=30');
    expect(page.editorial?.ranking[0]).toMatchObject({ rank: 1, averageFocusMinutesPerDay: 185 });
    expect(page.editorial?.note).toEqual({ type: 'TIP', body: null, tipNo: 5 });
    expect(page.cells.map((c) => [c.promotionId, c.relation])).toEqual([['p1', 'MEMBER']]);
    expect(page.nextCursor).toBe('c+1');

    stub(200, { issue: issueWire, editorial: null, cells: [], nextCursor: null });
    const next = await getMagazineIssue('iss-19', 'c+1', 3);
    expect(path(calls[1])).toBe('/me/magazine/issues/iss-19?limit=3&cursor=c%2B1');
    expect(next.editorial).toBeNull();
    expect(next.nextCursor).toBeNull();
  });

  test('편집부 모양이 어긋나면 편집부만 빼고 칸은 보인다 · 빈 커서는 끝 · 꽂이의 깨진 줄은 그 줄만 뺀다', async () => {
    stub(200, {
      issue: issueWire,
      editorial: { ranking: 'x', newIslands: [], note: null },
      cells: [{ ...island('소다'), promotionId: 'p1', body: '안녕', layout }],
      nextCursor: '',
    });
    const page = await getMagazineIssue('iss-19');
    expect(page.editorial).toBeNull();
    expect(page.cells).toHaveLength(1);
    expect(page.nextCursor).toBeNull();

    const { current: _current, ...head } = issueWire;
    stub(200, { items: [{ ...head, opened: true }, { issueId: 'broken' }] });
    await expect(getMagazineIssues()).resolves.toEqual([{ ...head, opened: true }]);
  });

  test.each([
    ['모르는 유형', { type: 'NEWS', body: '?', tipNo: null }],
    ['번호 없는 팁', { type: 'TIP', body: null, tipNo: null }],
    ['글 없는 편집부 소식', { type: 'EDITOR', body: '', tipNo: null }],
  ])('편집부 한마디가 %s 이면 편집부를 빼고(팁을 지어내지 않는다) 칸은 보인다', async (_, note) => {
    stub(200, {
      issue: issueWire,
      editorial: { ranking: [], newIslands: [], note },
      cells: [{ ...island('소다'), promotionId: 'p1', body: '안녕', layout }],
      nextCursor: null,
    });
    const page = await getMagazineIssue('iss-19');
    expect(page.editorial).toBeNull();
    expect(page.cells).toHaveLength(1);
  });

  test('7호 밖이면 404 MAGAZINE_ISSUE_NOT_FOUND 를 그대로 던진다', async () => {
    stub(404, { code: 'MAGAZINE_ISSUE_NOT_FOUND', message: '잡지 호를 찾을 수 없어요' });
    await expect(getMagazineIssue('old')).rejects.toMatchObject({
      code: 'MAGAZINE_ISSUE_NOT_FOUND',
      status: 404,
    });
  });

  test('받음 — 서버가 허용하는 키(place·deferred·opened)만, true 인 것만 보낸다', async () => {
    const receipt = {
      place: 'ISLAND',
      receivedAt: '2026-10-13T23:00:00Z',
      deferredAt: null,
      openedAt: '2026-10-13T23:01:00Z',
    };
    stub(200, receipt);
    await expect(
      putMagazineReceipt('iss-19', { place: 'ISLAND', deferred: false, opened: true }),
    ).resolves.toEqual(receipt);
    expect(path(calls[0])).toBe('/me/magazine/issues/iss-19/receipt');
    expect(calls[0].init.method).toBe('PUT');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ place: 'ISLAND', opened: true });
  });
});

describe('신고', () => {
  test('신고 — POST {reason}, 키 없이. 새 신고 201 은 created, 이미 한 신고 200 은 created=false', async () => {
    stub(201, { reported: true });
    await expect(reportPromotion('i 1', 'p/1', 'SPAM_FRAUD')).resolves.toEqual({ created: true });
    expect(path(calls[0])).toBe('/islands/i%201/promotions/p%2F1/reports');
    expect(calls[0].init.method).toBe('POST');
    expect(header(calls[0], 'Idempotency-Key')).toBeUndefined();
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ reason: 'SPAM_FRAUD' });

    stub(200, { reported: true });
    await expect(reportPromotion('i1', 'p1', 'OTHER')).resolves.toEqual({ created: false });
  });

  test('신고 — 게스트 403 은 코드 그대로, 계약과 다른 성공은 CLIENT_CONTRACT_ERROR', async () => {
    stub(403, { error: { code: 'SOCIAL_LOGIN_REQUIRED', message: 'x' } });
    await expect(reportPromotion('i1', 'p1', 'HATE')).rejects.toMatchObject({
      code: 'SOCIAL_LOGIN_REQUIRED',
      status: 403,
    });
    stub(201, { reported: false });
    await expect(reportPromotion('i1', 'p1', 'HATE')).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_ERROR',
    });
  });
});

test.each([true, false, undefined])(
  '잡지 칸·편집부의 privateIsland=%s — 키가 없으면 false로 읽는다',
  async (privateIsland) => {
    const raw = { ...island('초대섬'), ...(privateIsland === undefined ? {} : { privateIsland }) };
    stub(200, {
      issue: issueWire,
      editorial: {
        ranking: [{ ...raw, rank: 1 }],
        newIslands: [raw],
        note: { type: 'TIP', tipNo: 0 },
      },
      cells: [{ ...raw, promotionId: 'private-ad', body: '함께해요', layout }],
      nextCursor: null,
    });
    const page = await getMagazineIssue('iss-19');
    expect(page.cells[0].privateIsland).toBe(privateIsland === true);
    expect(page.editorial?.ranking[0].privateIsland).toBe(privateIsland === true);
    expect(page.editorial?.newIslands[0].privateIsland).toBe(privateIsland === true);
  },
);
