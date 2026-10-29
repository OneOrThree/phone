import { ChannelClient, ChannelState, MetadataTransport } from './channelClient';
import { canonical, digest } from './contracts';
const initial: ChannelState = { lastSuccess: 0, failureCount: 0, nextRetry: 0 };
function response(generation = 1, releaseId = 'r1') {
  const manifest = canonical({ schemaVersion: 1, assetApiVersion: 1, releaseId, packs: {} });
  return {
    manifest,
    channel: JSON.stringify({
      schemaVersion: 1,
      assetApiVersion: 1,
      generation,
      releaseId,
      manifestPath: `releases/${releaseId}/manifest.json`,
      manifestSha256: digest(manifest),
      manifestBytes: manifest.length,
    }),
  };
}
test('304에 로컬 manifest가 없으면 ETag 없이 다시 받고 native 한도를 전달한다', async () => {
  const data = response();
  const transport = jest
    .fn()
    .mockResolvedValueOnce({ status: 304, text: '' })
    .mockResolvedValueOnce({ status: 200, text: data.channel, etag: 'new' })
    .mockResolvedValueOnce({ status: 200, text: data.manifest });
  const client = new ChannelClient('https://cdn.example', 'dev', fetch, transport);
  const result = await client.refresh({ ...initial, etag: 'old' }, 10);
  expect(result.manifest?.releaseId).toBe('r1');
  expect(transport.mock.calls[0][0]).toMatchObject({
    maxBytes: 16384,
    timeoutMs: 10000,
    etag: 'old',
    allowedOrigins: ['https://cdn.example'],
  });
  expect(transport.mock.calls[1][0].etag).toBeUndefined();
  expect(transport.mock.calls[2][0].maxBytes).toBe(1024 ** 2);
});
test('같은 generation 다른 digest 거부, 높은 generation 이전 release 롤백 허용', async () => {
  let data = response(2, 'r2');
  const transport: MetadataTransport = async (options) => ({
    status: 200,
    text: options.url.includes('/channels/') ? data.channel : data.manifest,
  });
  const client = new ChannelClient('https://cdn.example', 'dev', fetch, transport);
  const previous = await client.refresh(initial, 10);
  data = response(2, 'r1');
  await expect(client.refresh(previous, 20)).rejects.toThrow('generation collision');
  data = response(3, 'r1');
  expect((await client.refresh(previous, 30)).manifest?.releaseId).toBe('r1');
});
test('403은 재시도하지 않고 5xx는 한 번만 추가 시도한다', async () => {
  const transport = jest.fn().mockResolvedValue({ status: 403, text: '' });
  const client = new ChannelClient('https://cdn.example', 'dev', fetch, transport);
  await expect(client.refresh(initial, 10)).rejects.toThrow('403');
  expect(transport).toHaveBeenCalledTimes(1);
  transport.mockClear().mockResolvedValue({ status: 503, text: '' });
  await expect(client.refresh(initial, 10)).rejects.toThrow('503');
  expect(transport).toHaveBeenCalledTimes(2);
});
