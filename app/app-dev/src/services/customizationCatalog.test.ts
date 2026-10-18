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
