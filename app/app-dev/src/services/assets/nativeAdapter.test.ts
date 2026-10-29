import { Image } from 'react-native';
import { nativePort } from './nativeAdapter';
const mockNative = {
  apiVersion: 1,
  rootUri: 'file:///cache/image-cdn/v1',
  fetchMetadata: jest.fn(),
  downloadVerified: jest.fn(),
  inspectFile: jest.fn(),
  inspectPng: jest.fn(),
  publishObject: jest.fn(),
  writeSnapshot: jest.fn(),
};
jest.mock('../../../modules/catus-asset-cache', () => ({ getAssetCacheNative: () => mockNative }));
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});
test('metadata와 이미지 네트워크는 같은 동시성 2 예산을 쓴다', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockNative.fetchMetadata.mockImplementation(async () => {
    await gate;
    return { status: 200, text: '{}' };
  });
  mockNative.downloadVerified.mockResolvedValue({
    uri: `${mockNative.rootUri}/staging/job.partial`,
    bytes: 1,
    sha256: 'a'.repeat(64),
  });
  const port = nativePort()!;
  const options = {
    url: 'https://cdn.example/channels/dev/1.json',
    allowedOrigins: ['https://cdn.example'],
    maxBytes: 16384,
    timeoutMs: 10000,
  };
  const first = port.metadata!(options),
    second = port.metadata!(options);
  const third = port.download({
    url: 'https://cdn.example/assets/image.png',
    allowedOrigins: ['https://cdn.example'],
    jobId: 'job',
    expectedBytes: 1,
    expectedSha256: 'a'.repeat(64),
    timeoutMs: 60000,
  });
  await Promise.resolve();
  expect(mockNative.fetchMetadata).toHaveBeenCalledTimes(2);
  expect(mockNative.downloadVerified).not.toHaveBeenCalled();
  release();
  await Promise.all([first, second, third]);
  expect(mockNative.downloadVerified).toHaveBeenCalledTimes(1);
});
test('native 결과라도 캐시 root 밖 URI는 소비자에게 전달하지 않는다', async () => {
  mockNative.downloadVerified.mockResolvedValue({
    uri: 'file:///private/other.png',
    bytes: 1,
    sha256: 'a'.repeat(64),
  });
  await expect(
    nativePort()!.download({
      url: 'https://cdn.example/assets/image.png',
      allowedOrigins: ['https://cdn.example'],
      jobId: 'job',
      expectedBytes: 1,
      expectedSha256: 'a'.repeat(64),
      timeoutMs: 60000,
    }),
  ).rejects.toThrow('cache path');
});

test.each(['malformed PNG', 'oversized PNG'])(
  '%s 헤더 거부는 이미지 디코더를 실행하지 않는다',
  async (message) => {
    mockNative.inspectPng.mockRejectedValue(new Error(message));
    const getSize = jest.spyOn(Image, 'getSize');
    const uri = `${mockNative.rootUri}/staging/job.partial`;
    await expect(nativePort()!.decode(uri, 1024, 1536)).rejects.toThrow(message);
    expect(mockNative.inspectPng).toHaveBeenCalledWith(uri);
    expect(getSize).not.toHaveBeenCalled();
  },
);
test('실제 IHDR 크기가 manifest와 다르면 이미지 디코더를 실행하지 않는다', async () => {
  mockNative.inspectPng.mockResolvedValue({ width: 2048, height: 1536 });
  const getSize = jest.spyOn(Image, 'getSize');
  await expect(
    nativePort()!.decode(`${mockNative.rootUri}/staging/job.partial`, 1024, 1536),
  ).rejects.toThrow('PNG dimensions');
  expect(getSize).not.toHaveBeenCalled();
});
test('헤더 검증이 끝난 정상 PNG만 RN 디코더로 전달한다', async () => {
  let finish!: (size: { width: number; height: number }) => void;
  const header = new Promise<{ width: number; height: number }>((resolve) => {
    finish = resolve;
  });
  mockNative.inspectPng.mockReturnValue(header);
  const getSize = jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => {
    success?.(1024, 1536);
    return Promise.resolve({ width: 1024, height: 1536 });
  });
  const operation = nativePort()!.decode(`${mockNative.rootUri}/staging/job.partial`, 1024, 1536);
  expect(getSize).not.toHaveBeenCalled();
  finish({ width: 1024, height: 1536 });
  await operation;
  expect(getSize).toHaveBeenCalledTimes(1);
});
