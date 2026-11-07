import AsyncStorage from '@react-native-async-storage/async-storage';
import { CLIENT_STALE_SESSION, request } from '@/services/api/client';
import { metaContext } from '@/services/metaSdk';
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
  getSession: jest.fn(() => ({ userId: 'a' })),
}));
jest.mock('@/services/firstArrivalConversion', () => ({
  captureFirstArrivalConversion: jest.fn(),
}));
import { captureFirstArrivalConversion } from './firstArrivalConversion';

jest.mock('@/services/metaSdk', () => ({ metaContext: jest.fn() }));
const destination = { islandId: 'candidate', name: '무인도' } as TelescopeItem;
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockGeneration = 7;
  (metaContext as jest.Mock).mockResolvedValue(undefined);
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

test.each([true, false, undefined])(
  '서버 최초 판정 %s에 따라 전환을 전달한다',
  async (firstIslandArrival) => {
    (request as jest.Mock).mockResolvedValue({ islandId: 'island', firstIslandArrival });
    await arriveFirstVoyage({ destination, key: 'receipt' }, 7);
    expect(captureFirstArrivalConversion).toHaveBeenCalledTimes(
      firstIslandArrival === true ? 1 : 0,
    );
    if (firstIslandArrival) expect(captureFirstArrivalConversion).toHaveBeenCalledWith('a', 7);
  },
);

test('도착 실패에는 전환을 전달하지 않는다', async () => {
  (request as jest.Mock).mockRejectedValueOnce(new Error('network'));
  await expect(arriveFirstVoyage({ destination, key: 'receipt' }, 7)).rejects.toThrow('network');
  expect(captureFirstArrivalConversion).not.toHaveBeenCalled();
});
