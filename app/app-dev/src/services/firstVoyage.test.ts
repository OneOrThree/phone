import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from '@/services/api/client';
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
const destination = { islandId: 'candidate', name: '무인도' } as TelescopeItem;
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
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
