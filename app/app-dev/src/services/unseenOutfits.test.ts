import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import {
  addUnseenOutfits,
  markOutfitSeen,
  resetUnseenOutfitsForTest,
  useUnseenOutfits,
} from './unseenOutfits';

let mockUserId: string | null = 'u1';
jest.mock('@/services/api/session', () => ({
  getSession: () => (mockUserId ? { userId: mockUserId } : null),
}));

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
const saved = async (userId: string) =>
  JSON.parse((await AsyncStorage.getItem(`gromo.unseenOutfits.${userId}`))!);

beforeEach(async () => {
  mockUserId = 'u1';
  resetUnseenOutfitsForTest();
  await AsyncStorage.clear();
});

test('결과창에서 받은 새 꾸미기는 사용자별로 저장되고, 본 것은 빠진다', async () => {
  await addUnseenOutfits('rec-1', ['cust.head.mandarin', 'cust.neck.bell']);
  expect(await saved('u1')).toEqual({
    ids: ['cust.head.mandarin', 'cust.neck.bell'],
    records: ['rec-1'],
  });
  const { result } = await renderHook(() => useUnseenOutfits());
  expect([...result.current]).toEqual(['cust.head.mandarin', 'cust.neck.bell']);
  await act(() => markOutfitSeen('cust.head.mandarin'));
  expect(result.current.has('cust.head.mandarin')).toBe(false);
  expect((await saved('u1')).ids).toEqual(['cust.neck.bell']);
  // 다른 사용자는 따로 — 앱을 다시 켜도(메모리 비움) 저장본을 읽는다
  resetUnseenOutfitsForTest();
  mockUserId = 'u2';
  await addUnseenOutfits('rec-2', ['cust.head.frog']);
  expect((await saved('u1')).ids).toEqual(['cust.neck.bell']);
  expect((await saved('u2')).ids).toEqual(['cust.head.frog']);
});

test('같은 기록의 결과창을 다시 보여도 이미 본 아이템이 NEW 로 돌아오지 않는다 — 앱을 다시 켜도', async () => {
  await addUnseenOutfits('rec-1', ['cust.head.mandarin']);
  await markOutfitSeen('cust.head.mandarin');
  await addUnseenOutfits('rec-1', ['cust.head.mandarin']);
  resetUnseenOutfitsForTest();
  await addUnseenOutfits('rec-1', ['cust.head.mandarin']);
  const { result } = await renderHook(() => useUnseenOutfits());
  expect(result.current.size).toBe(0);
  // 다른 기록이면 넣는다
  await act(() => addUnseenOutfits('rec-2', ['cust.head.mandarin']));
  expect(result.current.has('cust.head.mandarin')).toBe(true);
  expect((await saved('u1')).records).toEqual(['rec-1', 'rec-2']);
});

test('저장본을 못 읽으면 덮어쓰지 않는다 — 쓰기 전에 다시 읽어 합치고, 그래도 못 읽으면 메모리로만 동작한다', async () => {
  await AsyncStorage.setItem(
    'gromo.unseenOutfits.u1',
    JSON.stringify({ ids: ['cust.neck.bell'], records: ['rec-0'] }),
  );
  // 처음 읽기 실패 → 쓰기 직전 다시 읽기 성공: 저장본에 합쳐 쓴다
  getItem.mockRejectedValueOnce(new Error('disk'));
  await addUnseenOutfits('rec-1', ['cust.head.mandarin']);
  expect(await saved('u1')).toEqual({
    ids: ['cust.neck.bell', 'cust.head.mandarin'],
    records: ['rec-0', 'rec-1'],
  });
  // 두 번 다 실패: 저장본은 그대로이고 이번 실행 동안만 보인다
  resetUnseenOutfitsForTest();
  getItem.mockRejectedValueOnce(new Error('disk')).mockRejectedValueOnce(new Error('disk'));
  setItem.mockClear();
  await addUnseenOutfits('rec-2', ['cust.head.frog']);
  expect(setItem).not.toHaveBeenCalled();
  const { result } = await renderHook(() => useUnseenOutfits());
  expect(result.current.has('cust.head.frog')).toBe(true);
});

test('저장에 실패해도 이번 실행 동안은 메모리로 동작하고, 로그인 전에는 아무것도 하지 않는다', async () => {
  setItem.mockRejectedValueOnce(new Error('disk'));
  await addUnseenOutfits('rec-1', ['cust.head.mandarin']);
  const { result } = await renderHook(() => useUnseenOutfits());
  expect(result.current.has('cust.head.mandarin')).toBe(true);
  resetUnseenOutfitsForTest();
  mockUserId = null;
  await addUnseenOutfits('rec-2', ['cust.head.frog']);
  const guest = await renderHook(() => useUnseenOutfits());
  expect(guest.result.current.size).toBe(0);
});
