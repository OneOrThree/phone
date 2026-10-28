import { ApiError, request } from '@/services/api/client';
import {
  byProductId,
  forSlot,
  loadCustomizationCatalog,
  parseCatalog,
  resetCustomizationCatalogForTest,
} from './customizationCatalog';

jest.mock('@/services/api/client', () => ({
  ...jest.requireActual('@/services/api/client'),
  API_URL: 'https://api.test/',
  request: jest.fn(),
}));
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  getSession: () => (mockUser ? { userId: mockUser } : null),
  sessionGeneration: () => mockGeneration,
}));
let mockUser: string | null = 'me';
let mockGeneration = 1;
const mockRequest = request as jest.Mock;
const row = (over: Record<string, unknown> = {}) => ({
  productId: 'hat',
  kind: 'head',
  slot: 'head',
  title: '모자',
  imageUrl: '/static/customization/hat.png',
  width: 256,
  height: 128,
  anchorX: 0.5,
  anchorY: 0.2,
  sortOrder: 2,
  retiredAt: null,
  ...over,
});

beforeEach(() => {
  mockUser = 'me';
  mockGeneration = 1;
  resetCustomizationCatalogForTest();
  mockRequest.mockReset();
});

test('상대 imageUrl 은 API base 로 보완하고 모양이 틀린 항목은 버린다', () => {
  const table = parseCatalog([row(), row({ productId: 'x', slot: 'wings' }), null]);
  expect(Object.keys(table)).toEqual(['hat']);
  expect(table.hat.imageUrl).toBe('https://api.test/static/customization/hat.png');
  expect(parseCatalog([row({ imageUrl: 'https://cdn/a.png' })]).hat.imageUrl).toBe(
    'https://cdn/a.png',
  );
});

test('1시간 캐시 — 두 번째는 서버를 부르지 않고 byProductId·forSlot 이 sortOrder 순으로 읽는다', async () => {
  mockRequest.mockResolvedValue([row(), row({ productId: 'cap', sortOrder: 1 })]);
  await loadCustomizationCatalog();
  await loadCustomizationCatalog();
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(byProductId('hat')?.title).toBe('모자');
  expect(forSlot('head').map((e) => e.productId)).toEqual(['cap', 'hat']);
});

test('404 등 실패는 빈 표', async () => {
  mockRequest.mockRejectedValue(new Error('404'));
  expect(await loadCustomizationCatalog()).toEqual({});
  expect(forSlot('head')).toEqual([]);
});

test('로그인 전에는 조회하지 않는다', async () => {
  mockUser = null;
  expect(await loadCustomizationCatalog()).toEqual({});
  expect(mockRequest).not.toHaveBeenCalled();
});

test('401 은 캐시하지 않고, 로그인 세대가 바뀐 뒤 다음 사용에서 다시 읽어 반영한다', async () => {
  mockRequest.mockRejectedValueOnce(new ApiError('UNAUTHORIZED', 'x', 401));
  expect(await loadCustomizationCatalog()).toEqual({});
  mockGeneration = 2; // 로그인
  mockRequest.mockResolvedValueOnce([row()]);
  expect(Object.keys(await loadCustomizationCatalog())).toEqual(['hat']);
  expect(mockRequest).toHaveBeenCalledTimes(2);
});

test('실패 캐시는 60초 뒤 다시 읽고, 세대가 바뀌면 성공 캐시도 버린다', async () => {
  mockRequest.mockRejectedValueOnce(new Error('500'));
  const t0 = Date.now();
  await loadCustomizationCatalog(t0);
  await loadCustomizationCatalog(t0 + 30_000);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  mockRequest.mockResolvedValueOnce([row()]);
  expect(Object.keys(await loadCustomizationCatalog(Date.now() + 61_000))).toEqual(['hat']);
  expect(mockRequest).toHaveBeenCalledTimes(2);
  mockGeneration = 3;
  mockRequest.mockResolvedValueOnce([row({ productId: 'cap' })]);
  expect(Object.keys(await loadCustomizationCatalog())).toEqual(['cap']);
});

test('연속 실패마다 재조회 간격이 2배가 된다(60s → 120s) — 성공하면 초기화', async () => {
  mockRequest.mockRejectedValue(new Error('404'));
  await loadCustomizationCatalog(); // 1차 실패: 60s
  await loadCustomizationCatalog(Date.now() + 61_000); // 2차 실패: 120s
  expect(mockRequest).toHaveBeenCalledTimes(2);
  await loadCustomizationCatalog(Date.now() + 100_000);
  expect(mockRequest).toHaveBeenCalledTimes(2); // 아직 캐시
  await loadCustomizationCatalog(Date.now() + 121_000);
  expect(mockRequest).toHaveBeenCalledTimes(3);
});

// 서버 render_data(cat-fit-v1) 모양 — 집중 보상 머리·목·신발(GROMO-2382)
const render = (over: Record<string, unknown> = {}) => ({
  format: 'cat-fit-v1',
  target: 'cat',
  source: {
    path: '/static/customization/head/mandarin.cfb06049.png',
    width: 1254,
    height: 1254,
    crop: [329, 349, 940, 942],
  },
  coordinateSpace: 'black-cat-512',
  canvas: [512, 512],
  validatedMotions: { walk: 6, focus: 4, reel: 4 },
  rigPath: '/static/customization/rigs/head.0093c1a9.json',
  drawWidth: 64,
  itemDepthY: 9,
  contactFrames: { 'walk-0': { x: 277, y: 182, angleDegrees: -20.6 } },
  contactShadow: { widthFactor: 0.22, height: 2.5 },
  ...over,
});
const reward = (over: Record<string, unknown> = {}) =>
  row({
    productId: 'cust.head.mandarin',
    title: '귤 한 알',
    imageUrl: '/static/customization/head/mandarin.cfb06049.png',
    width: null,
    height: null,
    anchorX: null,
    anchorY: null,
    sortOrder: 0,
    renderData: render(),
    ...over,
  });

test('renderData(cat-fit-v1) 를 읽고 rig 경로는 imageUrl 과 같은 정적 base 로 보완한다', () => {
  const table = parseCatalog([row(), reward()]);
  expect('catFit' in table.hat).toBe(false);
  expect(table.hat.width).toBe(256);
  const fit = table['cust.head.mandarin'].catFit!;
  expect(table['cust.head.mandarin'].title).toBe('귤 한 알');
  expect(fit.crop).toEqual([329, 349, 940, 942]);
  expect(fit.motions).toEqual({ walk: 6, focus: 4, reel: 4 });
  expect(fit.rigUrls).toEqual({
    black: 'https://api.test/static/customization/rigs/head.0093c1a9.json',
  });
  // 6색 자료가 없는 옛 render_data 는 검정·애니메이션만
  expect(fit.colors).toEqual(['black']);
  expect(fit.stills).toEqual([]);
  expect(fit.head).toEqual({
    drawWidth: 64,
    depthY: 9,
    contacts: { black: { 'walk-0': { x: 277, y: 182, angleDegrees: -20.6 } } },
    shadow: { widthFactor: 0.22, height: 2.5 },
  });
  // STATIC_ASSETS_BASE_URL 로 절대 imageUrl 이 오면 rig 도 같은 호스트에서 받는다
  const cdn = parseCatalog([
    reward({ imageUrl: 'http://cdn:8088/static/customization/head/mandarin.cfb06049.png' }),
  ]);
  expect(cdn['cust.head.mandarin'].catFit!.rigUrls.black).toBe(
    'http://cdn:8088/static/customization/rigs/head.0093c1a9.json',
  );
});

test('목 renderData 는 공통 목줄을 읽고, 신발 cat-fit 은 보상에서 빠져 항목째 버린다', () => {
  const view = (box: number[]) => ({ box, rows: [[1, 2], null] });
  const table = parseCatalog([
    reward({
      productId: 'cust.neck.bell',
      slot: 'neck',
      kind: 'neck',
      renderData: render({
        neckStyle: 'pendant',
        views: { front: { box: [406, 406, 839, 913] }, kind: 'pendant' },
        commonBand: {
          path: '/static/customization/neck/common-band.1acc2be4.png',
          width: 1774,
          height: 887,
          crop: [0, 0, 1774, 887],
          view: { box: [82, 392, 1693, 493] },
        },
      }),
    }),
    reward({
      productId: 'cust.shoes.butter',
      slot: 'shoes',
      kind: 'shoes',
      renderData: render({
        views: { side: view([1, 2, 3, 4]), front: view([5, 6, 7, 8]), sole: view([9, 10, 11, 12]) },
      }),
    }),
  ]);
  expect(Object.keys(table)).toEqual(['cust.neck.bell']);
  expect(table['cust.neck.bell'].catFit!.neck).toEqual({
    style: 'pendant',
    front: [406, 406, 839, 913],
    commonBand: {
      url: 'https://api.test/static/customization/neck/common-band.1acc2be4.png',
      box: [82, 392, 1693, 493],
    },
  });
});

test('모양 틀린 renderData 는 항목째 버리고 기존 정적 항목 파싱은 그대로다', () => {
  const table = parseCatalog([
    row(),
    reward({ productId: 'a', renderData: render({ format: 'raft-fit-v1' }) }),
    reward({ productId: 'b', renderData: render({ contactFrames: { 'walk-0': { x: 1 } } }) }),
    reward({ productId: 'c', renderData: render({ source: { path: '/x.png' } }) }),
    reward({ productId: 'd', slot: 'decor', kind: 'decor' }),
    reward({ productId: 'e', renderData: 'cat-fit-v1' }),
  ]);
  expect(Object.keys(table)).toEqual(['hat']);
  expect(table.hat).toEqual({
    productId: 'hat',
    kind: 'head',
    slot: 'head',
    title: '모자',
    imageUrl: 'https://api.test/static/customization/hat.png',
    width: 256,
    height: 128,
    anchorX: 0.5,
    anchorY: 0.2,
    sortOrder: 2,
    retiredAt: null,
  });
});

// V136 의 6색 자세 자료 — 검정은 contactFrames·rigPath, 나머지 털색은 colorContactFrames·colorRigPaths
test('6색 renderData — 털색별 접촉점·목 rig·정지 그림·프로필 view 를 읽고, 틀린 칸이 있으면 항목째 버린다', () => {
  const fitted = render({
    validatedMotions: { walk: 6, focus: 4, reel: 4, blink: 3, read: 6 },
    validatedStills: ['idle', 'loaf', 'avatar'],
    validatedColors: ['black', 'ginger'],
    colorContactFrames: {
      ginger: {
        'walk-0': { x: 278, y: 183, angleDegrees: -19.7 },
        'still/avatar': {
          x: 259.57,
          y: 108.77,
          angleDegrees: -13.2,
          view: { x: -1.53, y: 126.36, scale: 1.1 },
        },
      },
    },
  });
  const neck = render({
    rigPath: '/static/customization/rigs/neck.e4b2796b.json',
    colorRigPaths: { ginger: '/static/customization/rigs/neck-ginger.a128a7c8.json' },
    validatedColors: ['black', 'ginger'],
    neckStyle: 'pendant',
    views: { front: { box: [406, 406, 839, 913] }, kind: 'pendant' },
    commonBand: {
      path: '/static/customization/neck/common-band.1acc2be4.png',
      view: { box: [1, 2, 3, 4] },
    },
  });
  const table = parseCatalog([
    reward({ renderData: fitted }),
    reward({ productId: 'cust.neck.bell', slot: 'neck', kind: 'neck', renderData: neck }),
    reward({
      productId: 'broken',
      renderData: { ...fitted, colorContactFrames: { ginger: { 'walk-0': { x: 1, y: 2 } } } },
    }),
    reward({
      productId: 'broken-view',
      renderData: {
        ...fitted,
        colorContactFrames: {
          ginger: { 'still/avatar': { x: 1, y: 2, angleDegrees: 0, view: { x: 1 } } },
        },
      },
    }),
  ]);
  expect(Object.keys(table)).toEqual(['cust.head.mandarin', 'cust.neck.bell']);
  const fit = table['cust.head.mandarin'].catFit!;
  expect(fit.colors).toEqual(['black', 'ginger']);
  expect(fit.stills).toEqual(['idle', 'loaf', 'avatar']);
  expect(fit.motions).toEqual({ walk: 6, focus: 4, reel: 4, blink: 3, read: 6 });
  expect(fit.head!.contacts.black['walk-0']).toEqual({ x: 277, y: 182, angleDegrees: -20.6 });
  expect(fit.head!.contacts.ginger['still/avatar'].view).toEqual({
    x: -1.53,
    y: 126.36,
    scale: 1.1,
  });
  expect(table['cust.neck.bell'].catFit!.rigUrls).toEqual({
    black: 'https://api.test/static/customization/rigs/neck.e4b2796b.json',
    ginger: 'https://api.test/static/customization/rigs/neck-ginger.a128a7c8.json',
  });
});
