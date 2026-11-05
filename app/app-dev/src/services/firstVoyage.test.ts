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
jest.mock('@/services/posthog', () => ({ captureProductEvent: jest.fn() }));
const { captureProductEvent } = jest.requireMock('@/services/posthog') as {
  captureProductEvent: jest.Mock;
};
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
test('응답에 firstArrivalEventId 가 있을 때만 SDK 에 두 이벤트를 같은 ID로 기록한다', async () => {
  const intent = await prepareFirstVoyage('a', destination);
  (request as jest.Mock).mockResolvedValueOnce({
    islandId: 'island-1',
    firstArrivalEventId: 'evt-1',
  });
  await expect(arriveFirstVoyage(intent, 7)).resolves.toMatchObject({
    firstArrivalEventId: 'evt-1',
  });
  expect(logMetaEvent).toHaveBeenCalledTimes(2);
  expect(logMetaEvent).toHaveBeenCalledWith('first_island_arrival', 'evt-1');
  expect(logMetaEvent).toHaveBeenCalledWith('fb_mobile_complete_registration', 'evt-1');
  // GROMO-2753: 같은 도착을 PostHog·Airbridge(Google Ads 전환) 로도 보내고 SDK 기록 결과를 남긴다.
  await new Promise(setImmediate);
  expect(captureProductEvent).toHaveBeenCalledTimes(1);
  expect(captureProductEvent).toHaveBeenCalledWith('first_island_arrival', { meta_sdk_logged: 1 });

  (logMetaEvent as jest.Mock).mockClear();
  captureProductEvent.mockClear();
  (request as jest.Mock).mockResolvedValueOnce({ islandId: 'island-1' });
  await arriveFirstVoyage(intent, 7);
  await new Promise(setImmediate);
  expect(logMetaEvent).not.toHaveBeenCalled();
  expect(captureProductEvent).not.toHaveBeenCalled();
});

test('SDK 기록이 실패해도 도착 결과는 그대로 돌려준다', async () => {
  const intent = await prepareFirstVoyage('a', destination);
  (request as jest.Mock).mockResolvedValueOnce({
    islandId: 'island-1',
    firstArrivalEventId: 'evt-2',
  });
  (logMetaEvent as jest.Mock).mockRejectedValueOnce(new Error('boom'));
  await expect(arriveFirstVoyage(intent, 7)).resolves.toMatchObject({ islandId: 'island-1' });
  // SDK 기록이 실패해도 Airbridge·PostHog 이벤트는 나가고 실패를 0 으로 남긴다(GROMO-2753).
  await new Promise(setImmediate);
  expect(captureProductEvent).toHaveBeenCalledWith('first_island_arrival', { meta_sdk_logged: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

test('매칭 값을 3초까지 기다리고 이후에는 값 없이 도착한다', async () => {
  jest.useFakeTimers();
  (metaContext as jest.Mock).mockReturnValue(new Promise(() => {}));
  const intent = await prepareFirstVoyage('a', destination);
  const pending = arriveFirstVoyage(intent, 7);
  await jest.advanceTimersByTimeAsync(2999);
  expect(request).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  await pending;
  expect(request).toHaveBeenCalledWith('/islands/candidate/intro-arrivals', {
    method: 'POST',
    idempotencyKey: intent.key,
    generation: 7,
  });
});

test('1초 뒤 3초 전에 받은 매칭 값도 도착에 싣는다', async () => {
  jest.useFakeTimers();
  const context = { anonId: 'anon-1', advertiserTrackingEnabled: false, extinfo: [] };
  (metaContext as jest.Mock).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(context), 2000)),
  );
  const intent = await prepareFirstVoyage('a', destination);
  const pending = arriveFirstVoyage(intent, 7);
  await jest.advanceTimersByTimeAsync(2000);
  await pending;
  expect(request).toHaveBeenCalledWith(
    '/islands/candidate/intro-arrivals',
    expect.objectContaining({ body: { meta: context } }),
  );
  expect(jest.getTimerCount()).toBe(0);
});

test('표준 이벤트 실패는 맞춤 이벤트의 PostHog 성공 값을 바꾸지 않는다', async () => {
  const intent = await prepareFirstVoyage('a', destination);
  (request as jest.Mock).mockResolvedValueOnce({
    islandId: 'island-1',
    firstArrivalEventId: 'evt-3',
  });
  (logMetaEvent as jest.Mock).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('boom'));
  await arriveFirstVoyage(intent, 7);
  await new Promise(setImmediate);
  expect(captureProductEvent).toHaveBeenCalledWith('first_island_arrival', { meta_sdk_logged: 1 });
});
