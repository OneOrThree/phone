import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GroupCardEmojiEditScreen, {
  claimGroupCardEmojiSave,
  ownsGroupCardIconSaveResult,
} from './GroupCardEmojiEditScreen';
import {
  __resetGroupCardEmojiQueueForTest,
  preservePendingGroupCardEmoji,
  readGroupCardEmoji,
  retryPendingGroupCardEmojis,
  subscribeGroupCardEmoji,
  writeGroupCardEmoji,
} from './groupCardEmojiStore';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: { groupId: 'group-1' } }),
}));

const mockSessionIdentity = { current: { userId: 'user-1' as string | null, active: true } };
const mockUser = { userId: 'user-1' as string | null, sessionIdentityRef: mockSessionIdentity };
jest.mock('@/store/UserContext', () => ({ useUser: () => mockUser }));
jest.mock('@/services/analyticsEvents', () => ({
  logGroupCardIconEditorViewed: jest.fn(),
  logGroupCardIconSaveResult: jest.fn(),
}));
const { logGroupCardIconEditorViewed, logGroupCardIconSaveResult } = jest.requireMock(
  '@/services/analyticsEvents',
);

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetGroupCardEmojiQueueForTest();
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockUser.userId = 'user-1';
  mockSessionIdentity.current = { userId: 'user-1', active: true };
});

test('현재 계정×그룹 아이콘을 선택 상태로 불러오고 같은 값에는 저장을 비활성화한다', async () => {
  await writeGroupCardEmoji('user-1', 'group-1', '📚');
  await render(<GroupCardEmojiEditScreen />);

  await waitFor(() =>
    expect(screen.getByTestId('group.cardEmoji.📚').props.accessibilityState).toEqual(
      expect.objectContaining({
        selected: true,
      }),
    ),
  );
  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
  expect(screen.getByText('이 기기에서 나에게만 보여요')).toBeOnTheScreen();
  expect(logGroupCardIconEditorViewed).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('group.cardEmoji.content').props.keyboardShouldPersistTaps).toBe(
    'handled',
  );
});

test('변경 저장은 서버 요청 없이 로컬 bucket만 바꾸고 화면을 닫는다', async () => {
  preservePendingGroupCardEmoji('user-1', 'group-1', '📚');
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));

  const preview = screen.getByTestId('group.cardEmoji.preview', { includeHiddenElements: true });
  expect(preview).toHaveTextContent('🔥내 그룹 카드불꽃');
  expect(preview.props.accessible).toBe(false);

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));

  await waitFor(async () => expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🔥'));
  expect(logGroupCardIconSaveResult).toHaveBeenCalledWith({
    surface: 'settings',
    result: 'success',
  });
  expect(mockGoBack).toHaveBeenCalledTimes(1);
  await retryPendingGroupCardEmojis('user-1', ['group-1']);
  expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🔥');
});

test('쓰기 실패는 선택을 유지하고 inline 오류와 재시도 가능한 저장 버튼을 남긴다', async () => {
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🧠')));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));

  expect(await screen.findByText(/내 카드 아이콘을 저장하지 못했어요/)).toBeOnTheScreen();
  expect(screen.getByTestId('group.cardEmoji.🧠').props.accessibilityState).toEqual(
    expect.objectContaining({ selected: true }),
  );
  expect(screen.getByTestId('group.cardEmoji.save')).not.toBeDisabled();
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(logGroupCardIconSaveResult).toHaveBeenCalledWith({
    surface: 'settings',
    result: 'failed',
  });
  await retryPendingGroupCardEmojis('user-1', ['group-1']);
  expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🧠');
});

test('저장 수락 즉시 현재 세션 카드에 선택을 낙관 반영한다', async () => {
  const observed: string[] = [];
  const unsubscribe = subscribeGroupCardEmoji('user-1', (_groupId, emoji) => {
    observed.push(`emit:${emoji}`);
  });
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    observed.push('persist');
    await AsyncStorage.multiSet([[key, value]]);
  });
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.📚')));

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(observed.slice(0, 2)).toEqual(['emit:📚', 'persist']);
  unsubscribe();
});

test('저장 실패 뒤 선택을 되돌리면 오래된 pending을 폐기하고 현재 카드를 기준값으로 복원한다', async () => {
  await writeGroupCardEmoji('user-1', 'group-1', '🎯');
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.📚')));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🎯')));
  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
  expect(await retryPendingGroupCardEmojis('user-1', ['group-1'])).toEqual({});
  expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🎯');
});

test('pending 선택을 카드와 편집기 초기값에 합성하되 저장 기준값은 디스크 값으로 유지한다', async () => {
  await writeGroupCardEmoji('user-1', 'group-1', '🎯');
  preservePendingGroupCardEmoji('user-1', 'group-1', '📚');
  await render(<GroupCardEmojiEditScreen />);

  await waitFor(() =>
    expect(screen.getByTestId('group.cardEmoji.📚').props.accessibilityState.selected).toBe(true),
  );
  expect(screen.getByTestId('group.cardEmoji.save')).not.toBeDisabled();
  expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('📚');
});

test('userId 미확정은 로컬 bucket을 만들지 않고 저장을 비활성화한다', async () => {
  mockUser.userId = null;
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));

  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
  expect(await AsyncStorage.getItem('gromo:groups:cardEmoji:v1')).toBeNull();
});

test('로컬 읽기 실패는 기본 아이콘으로 확정하지 않고 재시도를 제공한다', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('read failed'));
  await render(<GroupCardEmojiEditScreen />);

  expect(await screen.findByText('내 카드 아이콘을 불러오지 못했어요.')).toBeOnTheScreen();
  expect(screen.queryByTestId('group.cardEmoji.save')).toBeNull();

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.retry')));
  expect(await screen.findByTestId('group.cardEmoji.save')).toBeDisabled();
});

test('계정 전환 시 이전 계정 선택을 노출하지 않고 새 계정 bucket을 다시 읽는다', async () => {
  await writeGroupCardEmoji('user-1', 'group-1', '📚');
  await writeGroupCardEmoji('user-2', 'group-1', '🔥');
  const view = await render(<GroupCardEmojiEditScreen />);
  await waitFor(() =>
    expect(screen.getByTestId('group.cardEmoji.📚').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    ),
  );

  mockUser.userId = 'user-2';
  await view.rerender(<GroupCardEmojiEditScreen />);

  await waitFor(() =>
    expect(screen.getByTestId('group.cardEmoji.🔥').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    ),
  );
  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
});

test('계정 Provider가 폐기되거나 다른 계정이면 이전 저장 결과의 소유권을 인정하지 않는다', () => {
  expect(ownsGroupCardIconSaveResult({ userId: 'user-1', active: true }, 'user-1')).toBe(true);
  expect(ownsGroupCardIconSaveResult({ userId: 'user-1', active: false }, 'user-1')).toBe(false);
  expect(ownsGroupCardIconSaveResult({ userId: 'user-2', active: true }, 'user-1')).toBe(false);
});

test('저장 중에는 picker와 뒤로 버튼을 잠가 마지막 선택을 버리지 않는다', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalSetItem = AsyncStorage.setItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    await gate;
    await originalSetItem(key, value);
  });
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.📚')));
  fireEvent.press(screen.getByTestId('group.cardEmoji.save'));

  await waitFor(() => expect(screen.getByTestId('group.cardEmoji.🔥')).toBeDisabled());
  expect(screen.getByTestId('group.cardEmoji.save').props.accessibilityLabel).toBe('저장 중…');
  expect(screen.getByTestId('group.cardEmoji.save').props.accessibilityState).toEqual(
    expect.objectContaining({ busy: true, disabled: true }),
  );
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));
  expect(screen.getByTestId('group.cardEmoji.📚').props.accessibilityState.selected).toBe(true);

  release();
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('📚');
});

test('저장 연타 수락 가드는 React 상태 반영 전에도 한 번만 true를 반환한다', () => {
  const savingRef = { current: false };

  expect(claimGroupCardEmojiSave(savingRef)).toBe(true);
  expect(claimGroupCardEmojiSave(savingRef)).toBe(false);

  savingRef.current = false;
  expect(claimGroupCardEmojiSave(savingRef)).toBe(true);
});

test('저장 중 화면이 먼저 unmount되면 완료 콜백이 스택을 추가로 pop하지 않는다', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async () => gate);
  const view = await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.📚')));
  fireEvent.press(screen.getByTestId('group.cardEmoji.save'));
  await waitFor(() => expect(screen.getByTestId('group.cardEmoji.🔥')).toBeDisabled());

  view.unmount();
  await act(async () => {
    release();
    await gate;
    await Promise.resolve();
  });

  expect(mockGoBack).not.toHaveBeenCalled();
  expect(logGroupCardIconSaveResult).toHaveBeenCalledWith({
    surface: 'settings',
    result: 'success',
  });
});
