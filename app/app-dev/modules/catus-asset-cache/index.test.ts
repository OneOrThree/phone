const mockResolveNative = jest.fn();
jest.mock('expo', () => ({
  requireOptionalNativeModule: (...args: unknown[]) => mockResolveNative(...args),
}));

import { getAssetCacheNative } from './index';

const native = () => ({
  apiVersion: 1,
  rootUri: 'file:///cache/image-cdn/v1/',
  downloadVerified: jest.fn(),
  fetchMetadata: jest.fn(),
  cancelDownload: jest.fn(),
  inspectFile: jest.fn(),
  publishObject: jest.fn(),
  writeSnapshot: jest.fn(),
});

afterEach(() => mockResolveNative.mockReset());

test('구 바이너리에 네이티브 모듈이 없으면 번들 대체용 null 반환', () => {
  mockResolveNative.mockReturnValue(null);
  expect(getAssetCacheNative()).toBeNull();
  expect(mockResolveNative).toHaveBeenCalledWith('CatusAssetCache');
});

test('호환되지 않은 버전이나 불완전 capability는 사용하지 않는다', () => {
  for (const overrides of [{ apiVersion: 2 }, { rootUri: '' }, { fetchMetadata: undefined }]) {
    mockResolveNative.mockReturnValue({ ...native(), ...overrides });
    expect(getAssetCacheNative()).toBeNull();
  }
});

test('완전한 native 모듈을 그대로 반환하여 호출 계약을 유지한다', () => {
  const module = native();
  mockResolveNative.mockReturnValue(module);
  expect(getAssetCacheNative()).toBe(module);
});
