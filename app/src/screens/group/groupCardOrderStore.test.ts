import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import {
  __resetGroupCardOrderQueueForTest,
  parseGroupCardOrder,
  parseGroupCardOrderState,
  readGroupCardOrder,
  reconcileGroupCardOrder,
  writeGroupCardOrder,
} from './groupCardOrderStore';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetGroupCardOrderQueueForTest();
  jest.restoreAllMocks();
});

test('stable groupId 순서를 유지하고 stale·중복을 제거한 뒤 신규 그룹을 append한다', () => {
  expect(reconcileGroupCardOrder(['a', 'b', 'c', 'd'], ['c', 'gone', 'a', 'c'])).toEqual([
    'c',
    'a',
    'b',
    'd',
  ]);
});

test('11개 이상도 자르지 않고 모두 보존한다', () => {
  const ids = Array.from({ length: 12 }, (_, index) => `group-${index}`);
  expect(reconcileGroupCardOrder(ids, [...ids].reverse())).toEqual([...ids].reverse());
});

test('FindMore 같은 서버 목록 밖 UI sentinel은 저장 순서로 복원하지 않는다', () => {
  expect(reconcileGroupCardOrder(['a', 'b'], ['a', 'find-more', 'b'])).toEqual(['a', 'b']);
});

test('손상된 저장값은 안전하게 빈 map으로 읽는다', () => {
  expect(parseGroupCardOrder('{broken')).toEqual({});
  expect(parseGroupCardOrder('["a"]')).toEqual({});
  expect(parseGroupCardOrder(JSON.stringify({ u1: ['a', 1, 'a'], u2: 'bad' }))).toEqual({
    u1: ['a'],
  });
});

test('저장값 부재와 파싱 손상을 구분한다', () => {
  expect(parseGroupCardOrderState(null)).toEqual({ value: {}, needsRepair: false });
  expect(parseGroupCardOrderState('{broken')).toEqual({ value: {}, needsRepair: true });
  expect(parseGroupCardOrderState(JSON.stringify({ u1: 'bad' }))).toEqual({
    value: {},
    needsRepair: true,
  });
});

test('계정별 RMW 쓰기를 직렬화해 동시 갱신과 마지막 선택을 보존한다', async () => {
  await Promise.all([
    writeGroupCardOrder('u1', ['a']),
    writeGroupCardOrder('u2', ['b']),
    writeGroupCardOrder('u1', ['c', 'a']),
  ]);

  expect(await readGroupCardOrder('u1')).toEqual(['c', 'a']);
  expect(await readGroupCardOrder('u2')).toEqual(['b']);
});

test('쓰기 실패 뒤에도 큐가 살아 다음 쓰기를 수행한다', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(writeGroupCardOrder('u1', ['a'])).rejects.toThrow('disk full');
  await writeGroupCardOrder('u1', ['b']);
  expect(await readGroupCardOrder('u1')).toEqual(['b']);
});

test('다른 계정 bucket은 수정하지 않는다', async () => {
  await AsyncStorage.setItem(STORAGE_KEYS.groupCardOrder, JSON.stringify({ u1: ['a'], u2: ['z'] }));
  await writeGroupCardOrder('u1', ['b', 'a']);
  expect(parseGroupCardOrder(await AsyncStorage.getItem(STORAGE_KEYS.groupCardOrder))).toEqual({
    u1: ['b', 'a'],
    u2: ['z'],
  });
});

test('읽기는 호출 시점에 대기 중인 쓰기가 끝난 뒤 최신 값을 반환한다', async () => {
  let finishWrite: () => void = () => undefined;
  const writeGate = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  const originalSetItem = AsyncStorage.setItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    await writeGate;
    await originalSetItem(key, value);
  });

  const write = writeGroupCardOrder('u1', ['b', 'a']);
  await Promise.resolve();
  const read = readGroupCardOrder('u1');
  let settled = false;
  void read.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);

  finishWrite();
  await write;
  expect(await read).toEqual(['b', 'a']);
});
