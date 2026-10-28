import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAccountGuides } from './useAccountGuides';
import { initialState, reducer } from '@/services/model';
import { saveAccountGuides } from '@/services/accountGuides';
let mockGeneration = 1;
let mockOwner = 'alice';
jest.mock('@/services/api/session', () => ({
  sessionGeneration: () => mockGeneration,
  getLastSessionUserId: () => mockOwner,
}));
beforeEach(async () => {
  mockGeneration = 1;
  mockOwner = 'alice';
  await AsyncStorage.clear();
});

test('기존 우체통·상점·집중 완료 이력을 소유 계정으로 이관하고 섬 이동에도 유지한다', async () => {
  const state = {
    ...initialState(),
    mailboxGuideSeenBy: ['alice'],
    shopGuideSeenBy: ['alice'],
    tutorial: { step: 22 },
  };
  const dispatch = jest.fn();
  const h = await renderHook(() => useAccountGuides('alice', state, dispatch));
  await waitFor(() => expect(h.result.current.data?.focusDone).toBe(true));
  expect(h.result.current.data?.buildings).toEqual(['mail', 'shop']);
  expect(dispatch).toHaveBeenCalledWith({
    type: 'FOCUS_GUIDE_RESTORED',
    focusBlockingIntro: undefined,
  });
  await h.unmount();
  const next = await renderHook(() => useAccountGuides('alice', initialState(), dispatch));
  await waitFor(() => expect(next.result.current.data?.buildings).toEqual(['mail', 'shop']));
});

test('다른 계정의 저장본은 이관하지 않고 이전 계정의 늦은 저장 결과를 표시하지 않는다', async () => {
  const state = { ...initialState(), mailboxGuideSeenBy: ['alice'] };
  const dispatch = jest.fn();
  const h = await renderHook(
    ({ owner }: { owner: string }) => useAccountGuides(owner, state, dispatch),
    { initialProps: { owner: 'alice' } },
  );
  await waitFor(() => expect(h.result.current.data).not.toBeNull());
  let resolve!: () => void;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = h.result.current.done({ buildings: ['library'] });
  });
  mockOwner = 'bob';
  mockGeneration += 1;
  await h.rerender({ owner: 'bob' });
  await waitFor(() => expect(h.result.current.data?.buildings).toEqual([]));
  await act(async () => {
    resolve();
    await pending;
  });
  expect(h.result.current.data?.buildings).toEqual([]);
  jest.restoreAllMocks();
});

test('이미 본 설명은 재진입에도 완료 이력을 유지하고 쓰기 실패 시 닫지 않는다', async () => {
  await saveAccountGuides('alice', { buildings: ['hall'] });
  const dispatch = jest.fn();
  const h = await renderHook(() => useAccountGuides('alice', initialState(), dispatch));
  await waitFor(() => expect(h.result.current.data?.buildings).toEqual(['hall']));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
  await act(async () => {
    await h.result.current.done({ buildings: ['mail'] });
  });
  expect(h.result.current.data?.buildings).toEqual(['hall']);
  expect(h.result.current.error).toContain('저장하지 못했어요');
  await act(async () => {
    await h.result.current.done({ buildings: ['mail'] });
  });
  expect(h.result.current.data?.buildings).toEqual(['hall', 'mail']);
  jest.restoreAllMocks();
});

test('A의 예약을 B에게 넘기지 않고 A 재로그인 때 복원하며 소비 후에는 다시 예약하지 않는다', async () => {
  await saveAccountGuides('alice', { focusDone: true, focusBlockingIntro: 'pending' });
  let state = initialState();
  const dispatch = jest.fn((action) => {
    state = reducer(state, action);
  });
  const h = await renderHook(
    ({ owner }: { owner: string }) => useAccountGuides(owner, state, dispatch),
    { initialProps: { owner: 'alice' } },
  );
  await waitFor(() => expect(state.focusBlockingIntro).toBe('pending'));
  state = reducer(state, { type: 'LOGOUT' });
  mockOwner = 'bob';
  mockGeneration += 1;
  await h.rerender({ owner: 'bob' });
  await waitFor(() => expect(h.result.current.data?.focusDone).toBe(false));
  expect(state.focusBlockingIntro).toBeUndefined();

  mockOwner = 'alice';
  mockGeneration += 1;
  await h.rerender({ owner: 'alice' });
  await waitFor(() => expect(state.focusBlockingIntro).toBe('pending'));
  await act(async () => {
    state = reducer(state, { type: 'FOCUS_BLOCKING_INTRO_SEEN' });
    await h.result.current.done({ focusBlockingIntro: 'seen' });
  });
  await h.unmount();
  state = initialState();
  const next = await renderHook(() => useAccountGuides('alice', state, dispatch));
  await waitFor(() => expect(next.result.current.data?.focusBlockingIntro).toBe('seen'));
  expect(state.focusBlockingIntro).toBe('seen');
});
