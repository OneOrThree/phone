import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetGroupCardOrderQueueForTest,
  readGroupCardOrder,
  writeGroupCardOrder,
} from './groupCardOrderStore';
import { useGroupCardOrder } from './useGroupCardOrder';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetGroupCardOrderQueueForTest();
  jest.restoreAllMocks();
});

test('성공한 전체 목록에서 저장 순서를 hydrate하고 stale ID 수리본을 쓴다', async () => {
  await writeGroupCardOrder('me', ['gone', 'b', 'a']);
  const { result } = await renderHook(() =>
    useGroupCardOrder({ serverGroupIds: ['a', 'b', 'c'], userId: 'me' }),
  );

  await waitFor(() => expect(result.current.orderedGroupIds).toEqual(['b', 'a', 'c']));
  await waitFor(async () => expect(await readGroupCardOrder('me')).toEqual(['b', 'a', 'c']));
});

test('목록 실패·부분 응답에서는 읽기와 prune을 하지 않는다', async () => {
  await writeGroupCardOrder('me', ['gone', 'a']);
  const getItem = jest.spyOn(AsyncStorage, 'getItem').mockClear();
  const { result } = await renderHook(() =>
    useGroupCardOrder({ serverGroupIds: null, userId: 'me' }),
  );

  expect(result.current.hydrated).toBe(false);
  expect(getItem).not.toHaveBeenCalled();
  expect(await readGroupCardOrder('me')).toEqual(['gone', 'a']);
});

test('손상된 저장값은 성공한 전체 목록의 서버 순서로 복구해 기록한다', async () => {
  await AsyncStorage.setItem('gromo:groups:cardOrder:v1', '{broken');
  const { result } = await renderHook(() =>
    useGroupCardOrder({ serverGroupIds: ['a', 'b'], userId: 'me' }),
  );

  await waitFor(() => expect(result.current.orderedGroupIds).toEqual(['a', 'b']));
  await waitFor(async () => expect(await readGroupCardOrder('me')).toEqual(['a', 'b']));
});

test('계정 전환 직후 이전 계정 순서를 노출하지 않고 새 bucket으로 hydrate한다', async () => {
  await writeGroupCardOrder('u1', ['b', 'a']);
  await writeGroupCardOrder('u2', ['a', 'b']);
  const { result, rerender } = await renderHook(
    ({ userId }: { userId: string }) => useGroupCardOrder({ serverGroupIds: ['a', 'b'], userId }),
    { initialProps: { userId: 'u1' } },
  );
  await waitFor(() => expect(result.current.orderedGroupIds).toEqual(['b', 'a']));

  await rerender({ userId: 'u2' });
  await waitFor(() => expect(result.current.orderedGroupIds).toEqual(['a', 'b']));
});

test('로컬 쓰기 실패에도 현재 세션 순서는 유지하고 다음 커밋에서 복구한다', async () => {
  const { result } = await renderHook(() =>
    useGroupCardOrder({ serverGroupIds: ['a', 'b'], userId: 'me' }),
  );
  await waitFor(() => expect(result.current.hydrated).toBe(true));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

  await act(async () => {
    expect(result.current.commitOrder(['b', 'a'])).toBe(true);
  });
  await waitFor(() => expect(result.current.saveFailed).toBe(true));
  expect(result.current.orderedGroupIds).toEqual(['b', 'a']);

  await act(async () => {
    expect(result.current.commitOrder(['a', 'b'])).toBe(true);
  });
  await waitFor(() => expect(result.current.saveFailed).toBe(false));
});

test('저장 실패 뒤 서버 목록이 바뀌어도 세션 순서를 유지해 합성하고 재시도한다', async () => {
  const { result, rerender } = await renderHook(
    ({ ids }: { ids: string[] }) => useGroupCardOrder({ serverGroupIds: ids, userId: 'me' }),
    { initialProps: { ids: ['a', 'b'] } },
  );
  await waitFor(() => expect(result.current.hydrated).toBe(true));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

  await act(async () => {
    result.current.commitOrder(['b', 'a']);
  });
  await waitFor(() => expect(result.current.saveFailed).toBe(true));

  await rerender({ ids: ['a', 'b', 'c'] });
  await waitFor(() => expect(result.current.orderedGroupIds).toEqual(['b', 'a', 'c']));
  await waitFor(() => expect(result.current.saveFailed).toBe(false));
  expect(await readGroupCardOrder('me')).toEqual(['b', 'a', 'c']);
});

test('이전 계정의 늦은 저장 실패가 새 계정 오류 상태를 바꾸지 않는다', async () => {
  let rejectOldWrite: (error: Error) => void = () => undefined;
  const { result, rerender } = await renderHook(
    ({ userId }: { userId: string }) => useGroupCardOrder({ serverGroupIds: ['a', 'b'], userId }),
    { initialProps: { userId: 'u1' } },
  );
  await waitFor(() => expect(result.current.hydrated).toBe(true));
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(
    () =>
      new Promise<void>((_, reject) => {
        rejectOldWrite = reject;
      }),
  );

  await act(async () => {
    result.current.commitOrder(['b', 'a']);
  });
  await rerender({ userId: 'u2' });
  expect(result.current.hydrated).toBe(false);
  await act(async () => rejectOldWrite(new Error('old account write failed')));

  await waitFor(() => expect(result.current.hydrated).toBe(true));
  expect(result.current.saveFailed).toBe(false);
  expect(result.current.orderedGroupIds).toEqual(['a', 'b']);
});
