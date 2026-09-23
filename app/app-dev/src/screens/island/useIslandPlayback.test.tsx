import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError, CLIENT_NETWORK_ERROR } from '@/services/api/client';
import { getPlayback, patchPlayback, type PlaybackState } from '@/services/api/playback';
import { stompIslandChannel, type IslandChannelOpts } from '@/services/islandRealtime';
import { useIslandPlayback } from '@/screens/island/useIslandPlayback';

jest.mock('@/services/api/playback', () => ({
  getPlayback: jest.fn(),
  patchPlayback: jest.fn(),
}));
jest.mock('@/services/islandRealtime', () => ({
  stompIslandChannel: jest.fn(),
}));

const ISLAND = '11111111-2222-4333-8444-555555555555';
const playback = (over: Partial<PlaybackState> = {}): PlaybackState => ({
  trackId: 'waves',
  playing: false,
  positionSeconds: 0,
  effectiveAt: '2026-09-22T00:00:00Z',
  changedBy: null,
  version: 2,
  serverNow: '2026-09-22T00:00:01Z',
  durationSeconds: 120,
  ...over,
});

let channelOpts: IslandChannelOpts;

beforeEach(() => {
  jest.clearAllMocks();
  (getPlayback as jest.Mock).mockResolvedValue(playback());
  (stompIslandChannel as jest.Mock).mockImplementation((opts: IslandChannelOpts) => {
    channelOpts = opts;
    return { send: jest.fn(), reopen: jest.fn(), close: jest.fn() };
  });
});

test('진입 GET의 전체 상태를 적용하고 현재 version으로 PATCH한다', async () => {
  const dispatch = jest.fn();
  const next = playback({ trackId: 'rain', playing: true, version: 3, changedBy: 'u1' });
  (patchPlayback as jest.Mock).mockResolvedValue(next);
  const { result } = await renderHook(() =>
    useIslandPlayback({ active: true, islandId: ISLAND, dispatch }),
  );
  await waitFor(() => assert.equal(result.current.state?.version, 2));

  await act(async () => {
    await result.current.update({ trackId: 'rain', playing: true });
  });

  const [islandId, body, key] = (patchPlayback as jest.Mock).mock.calls[0];
  assert.equal(islandId, ISLAND);
  assert.deepEqual(body, { trackId: 'rain', playing: true, expectedVersion: 2 });
  assert.match(key, /^[0-9a-f-]{36}$/);
  assert.equal(result.current.state?.version, 3);
  assert.deepEqual(dispatch.mock.calls.at(-1)?.[0], {
    type: 'PLAYBACK_SYNC',
    islandId: ISLAND,
    playback: next,
    observedAtMs: dispatch.mock.calls.at(-1)?.[0].observedAtMs,
  });
  assert.equal(typeof dispatch.mock.calls.at(-1)?.[0].observedAtMs, 'number');
});

test('연속 재생 명령은 앞 요청 뒤에 최신 version으로 직렬 실행한다', async () => {
  let finishFirst!: (value: PlaybackState) => void;
  (patchPlayback as jest.Mock)
    .mockImplementationOnce(() => new Promise<PlaybackState>((resolve) => (finishFirst = resolve)))
    .mockResolvedValueOnce(playback({ playing: false, version: 4 }));
  const dispatch = jest.fn();
  const { result } = await renderHook(() =>
    useIslandPlayback({ active: true, islandId: ISLAND, dispatch }),
  );
  await waitFor(() => assert.equal(result.current.state?.version, 2));

  let play!: Promise<PlaybackState>;
  let stop!: Promise<PlaybackState>;
  play = result.current.update({ playing: true });
  stop = result.current.update({ playing: false });
  await waitFor(() => assert.equal((patchPlayback as jest.Mock).mock.calls.length, 1));
  await act(async () => {
    finishFirst(playback({ playing: true, version: 3 }));
    await Promise.all([play, stop]);
  });

  assert.deepEqual((patchPlayback as jest.Mock).mock.calls[1][1], {
    playing: false,
    expectedVersion: 3,
  });
});

test('응답 유실 재시도는 같은 body와 멱등 키를 다시 사용한다', async () => {
  (patchPlayback as jest.Mock)
    .mockRejectedValueOnce(new ApiError(CLIENT_NETWORK_ERROR, '연결 실패', 0))
    .mockResolvedValueOnce(playback({ playing: true, version: 3 }));
  const dispatch = jest.fn();
  const { result } = await renderHook(() =>
    useIslandPlayback({ active: true, islandId: ISLAND, dispatch }),
  );
  await waitFor(() => assert.equal(result.current.state?.version, 2));

  await act(async () => {
    await result.current.update({ playing: true });
  });

  const first = (patchPlayback as jest.Mock).mock.calls[0];
  const retry = (patchPlayback as jest.Mock).mock.calls[1];
  assert.deepEqual(retry[1], first[1]);
  assert.equal(retry[2], first[2]);
});

test('더 높은 playback.updated만 적용하고 재연결 onOpen에서 GET으로 복구한다', async () => {
  const dispatch = jest.fn();
  const { result } = await renderHook(() =>
    useIslandPlayback({ active: true, islandId: ISLAND, dispatch }),
  );
  await waitFor(() => assert.equal(result.current.state?.version, 2));

  await act(async () => {
    channelOpts.onEvent({
      schemaVersion: 1,
      type: 'playback.updated',
      islandId: ISLAND,
      aggregateVersion: 4,
      payload: playback({ trackId: 'rain', playing: true, version: 4 }),
    });
  });
  assert.equal(result.current.state?.version, 4);

  await act(async () => {
    channelOpts.onEvent({
      schemaVersion: 1,
      type: 'playback.updated',
      islandId: ISLAND,
      aggregateVersion: 3,
      payload: playback({ trackId: 'campfire', version: 3 }),
    });
  });
  assert.equal(result.current.state?.trackId, 'rain');

  (getPlayback as jest.Mock).mockResolvedValue(playback({ version: 5, playing: false }));
  await act(async () => channelOpts.onOpen());
  await waitFor(() => assert.equal(result.current.state?.version, 5));
});

test('서버 null trackId를 미선택 상태로 그대로 전달한다', async () => {
  const dispatch = jest.fn();
  (getPlayback as jest.Mock).mockResolvedValue(playback({ trackId: null, version: 0 }));
  const { result } = await renderHook(() =>
    useIslandPlayback({ active: true, islandId: ISLAND, dispatch }),
  );
  await waitFor(() => assert.equal(result.current.state?.version, 0));
  assert.equal(result.current.state?.trackId, null);
  assert.equal(dispatch.mock.calls.at(-1)?.[0].playback.trackId, null);
});
