import { request } from '@/services/api/client';
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
