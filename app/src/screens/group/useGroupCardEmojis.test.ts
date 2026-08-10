import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { writeGroupCardEmoji } from './groupCardEmojiStore';
import { useGroupCardEmojis } from './useGroupCardEmojis';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

test('현재 계정의 저장 아이콘을 덱에 투영하고 미저장 그룹은 기본값을 쓴다', async () => {
  await writeGroupCardEmoji('u1', 'g1', '📚');
  const { result } = await renderHook(() =>
    useGroupCardEmojis({ userId: 'u1', groupIds: ['g1', 'g2'] }),
  );

  await waitFor(() => expect(result.current.hydrated).toBe(true));
  expect(result.current.emojiFor('g1')).toBe('📚');
  expect(result.current.emojiFor('g2')).toBe('🎯');
});

test('계정 전환 직후 이전 계정 아이콘을 노출하지 않는다', async () => {
  await writeGroupCardEmoji('u1', 'g1', '📚');
  await writeGroupCardEmoji('u2', 'g1', '🔥');
  const { result, rerender } = await renderHook(
    ({ userId }: { userId: string }) =>
      useGroupCardEmojis({ userId, groupIds: ['g1'], reloadToken: 1 }),
    { initialProps: { userId: 'u1' } },
  );
  await waitFor(() => expect(result.current.emojiFor('g1')).toBe('📚'));

  const saved = await AsyncStorage.getItem(STORAGE_KEYS.groupCardEmoji);
  let finishNewAccountRead: (value: string | null) => void = () => undefined;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishNewAccountRead = resolve;
      }),
  );
  await rerender({ userId: 'u2' });
  expect(result.current.hydrated).toBe(false);
  expect(result.current.emojiFor('g1')).toBe('🎯');
  await act(async () => finishNewAccountRead(saved));
  await waitFor(() => expect(result.current.emojiFor('g1')).toBe('🔥'));
});

test('목록 revision이 바뀌면 설정 화면에서 저장한 아이콘을 다시 읽는다', async () => {
  const { result, rerender } = await renderHook(
    ({ revision }: { revision: number }) =>
      useGroupCardEmojis({ userId: 'u1', groupIds: ['g1'], reloadToken: revision }),
    { initialProps: { revision: 1 } },
  );
  await waitFor(() => expect(result.current.hydrated).toBe(true));
  expect(result.current.emojiFor('g1')).toBe('🎯');

  await writeGroupCardEmoji('u1', 'g1', '🧠');
  await rerender({ revision: 2 });
  await waitFor(() => expect(result.current.emojiFor('g1')).toBe('🧠'));
});
