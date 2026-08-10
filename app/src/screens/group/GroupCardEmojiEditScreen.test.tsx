import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GroupCardEmojiEditScreen from './GroupCardEmojiEditScreen';
import {
  logGroupCardIconEditorViewed,
  logGroupCardIconSaveResult,
} from '@/services/analyticsEvents';
import {
  __resetGroupCardEmojiQueueForTest,
  readGroupCardEmoji,
  writeGroupCardEmoji,
} from './groupCardEmojiStore';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, addListener: jest.fn(() => jest.fn()) }),
  useRoute: () => ({ params: { groupId: 'group-1' } }),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logGroupCardIconEditorViewed: jest.fn(),
  logGroupCardIconSaveResult: jest.fn(),
}));
const mockAnalyticsSession = { current: true };
jest.mock('@/services/analytics', () => ({
  isCurrentAnalyticsUserId: jest.fn(() => mockAnalyticsSession.current),
}));
const mockLogGroupCardIconEditorViewed = logGroupCardIconEditorViewed as jest.MockedFunction<
  typeof logGroupCardIconEditorViewed
>;
const mockLogGroupCardIconSaveResult = logGroupCardIconSaveResult as jest.MockedFunction<
  typeof logGroupCardIconSaveResult
>;

const mockUser = { userId: 'user-1' as string | null };
jest.mock('@/store/UserContext', () => ({ useUser: () => mockUser }));

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetGroupCardEmojiQueueForTest();
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockUser.userId = 'user-1';
  mockAnalyticsSession.current = true;
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
  expect(mockLogGroupCardIconEditorViewed).toHaveBeenCalledTimes(1);
});

test('변경 저장은 서버 요청 없이 로컬 bucket만 바꾸고 화면을 닫는다', async () => {
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));

  await waitFor(async () => expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🔥'));
  expect(mockLogGroupCardIconSaveResult).toHaveBeenCalledWith({
    surface: 'settings',
    result: 'success',
  });
  expect(mockGoBack).toHaveBeenCalledTimes(1);
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
  expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🧠');
  expect(mockLogGroupCardIconSaveResult).toHaveBeenCalledWith({
    surface: 'settings',
    result: 'failed',
  });
  expect(mockGoBack).not.toHaveBeenCalled();
});

test('쓰기 실패 뒤 기존 아이콘 재선택은 pending 값을 되돌려 저장할 수 있다', async () => {
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🧠')));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));
  await screen.findByText(/내 카드 아이콘을 저장하지 못했어요/);

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🎯')));
  expect(screen.getByTestId('group.cardEmoji.save')).not.toBeDisabled();
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));

  await waitFor(async () => expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🎯'));
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});

test('userId 미확정은 로컬 bucket을 만들지 않고 저장을 비활성화한다', async () => {
  mockUser.userId = null;
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));

  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
  expect(await AsyncStorage.getItem('gromo:groups:cardEmoji:v1')).toBeNull();
});
