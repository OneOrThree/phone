import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GroupCardEmojiEditScreen from './GroupCardEmojiEditScreen';
import {
  __resetGroupCardEmojiQueueForTest,
  preservePendingGroupCardEmoji,
  readGroupCardEmoji,
  retryPendingGroupCardEmojis,
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

const mockUser = { userId: 'user-1' as string | null };
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

test('userId 미확정은 로컬 bucket을 만들지 않고 저장을 비활성화한다', async () => {
  mockUser.userId = null;
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));

  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
  expect(await AsyncStorage.getItem('gromo:groups:cardEmoji:v1')).toBeNull();
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
  release();
  await act(async () => Promise.resolve());

  expect(mockGoBack).not.toHaveBeenCalled();
});
