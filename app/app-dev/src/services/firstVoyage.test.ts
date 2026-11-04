import AsyncStorage from '@react-native-async-storage/async-storage';
import { CLIENT_STALE_SESSION, request } from '@/services/api/client';
import { logMetaEvent, metaContext } from '@/services/metaSdk';
import {
  arriveFirstVoyage,
  completeFirstVoyage,
  prepareFirstVoyage,
  readFirstVoyage,
} from './firstVoyage';
import type { TelescopeItem } from '@/services/api/telescope';

jest.mock('@/services/api/client', () => ({
  ...jest.requireActual('@/services/api/client'),
  request: jest.fn(),
}));
let mockGeneration = 7;
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  sessionGeneration: () => mockGeneration,
}));
jest.mock('@/services/metaSdk', () => ({ metaContext: jest.fn(), logMetaEvent: jest.fn() }));
const destination = { islandId: 'candidate', name: '무인도' } as TelescopeItem;
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockGeneration = 7;
  (metaContext as jest.Mock).mockResolvedValue(undefined);
  (logMetaEvent as jest.Mock).mockResolvedValue(true);
  (request as jest.Mock).mockResolvedValue({ islandId: 'island-1', arrivedBefore: false });
});

test('완료는 설치 단위이며 계정 전환에도 유지하고 재설치로 초기화할 수 있다', async () => {
  expect((await readFirstVoyage('a')).eligible).toBe(true);
  await completeFirstVoyage('a');
  expect((await readFirstVoyage('b')).eligible).toBe(false);
  await AsyncStorage.clear();
  expect((await readFirstVoyage('a')).eligible).toBe(true);
});

test('응답 유실·재시작은 같은 목적지와 키로 재시도하고 계정 사이에는 의도를 공유하지 않는다', async () => {
  const first = await prepareFirstVoyage('a', destination);
  const retry = await prepareFirstVoyage('a', { ...destination, islandId: 'new-bucket' });
  expect(retry).toEqual(first);
  const other = await prepareFirstVoyage('b', destination);
  expect(other.key).not.toBe(first.key);
  await arriveFirstVoyage(retry, 7);
  expect(request).toHaveBeenCalledWith('/islands/candidate/intro-arrivals', {
    method: 'POST',
    idempotencyKey: first.key,
    generation: 7,
  });
  expect((await readFirstVoyage('a')).eligible).toBe(true);
});

test('Meta 값을 기다리는 사이 계정이 바뀌면 도착 요청을 보내지 않는다', async () => {
  let resolveMeta: (value: undefined) => void = () => {};
  (metaContext as jest.Mock).mockReturnValue(
    new Promise<undefined>((resolve) => (resolveMeta = resolve)),
  );
  const intent = await prepareFirstVoyage('a', destination);
  const arrival = arriveFirstVoyage(intent, 7);
  mockGeneration = 8;
  resolveMeta(undefined);
  await expect(arrival).rejects.toMatchObject({ code: CLIENT_STALE_SESSION });
  expect(request).not.toHaveBeenCalled();
});

// GROMO-2749: 계정 첫 도착이면 서버가 준 event_id 로 Meta SDK 에도 한 번 기록한다.
test('응답에 firstArrivalEventId 가 있을 때만 SDK 에 first_island_arrival 을 기록한다', async () => {
  const intent = await prepareFirstVoyage('a', destination);
  (request as jest.Mock).mockResolvedValueOnce({
    islandId: 'island-1',
    firstArrivalEventId: 'evt-1',
  });
  await expect(arriveFirstVoyage(intent, 7)).resolves.toMatchObject({
    firstArrivalEventId: 'evt-1',
  });
  expect(logMetaEvent).toHaveBeenCalledTimes(1);
  expect(logMetaEvent).toHaveBeenCalledWith('first_island_arrival', 'evt-1');

  (logMetaEvent as jest.Mock).mockClear();
  (request as jest.Mock).mockResolvedValueOnce({ islandId: 'island-1' });
  await arriveFirstVoyage(intent, 7);
  expect(logMetaEvent).not.toHaveBeenCalled();
});

test('SDK 기록이 실패해도 도착 결과는 그대로 돌려준다', async () => {
  const intent = await prepareFirstVoyage('a', destination);
  (request as jest.Mock).mockResolvedValueOnce({
    islandId: 'island-1',
    firstArrivalEventId: 'evt-2',
  });
  (logMetaEvent as jest.Mock).mockRejectedValueOnce(new Error('boom'));
  await expect(arriveFirstVoyage(intent, 7)).resolves.toMatchObject({ islandId: 'island-1' });
});
