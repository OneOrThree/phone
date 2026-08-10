import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GroupCardEmojiEditScreen, {
  claimGroupCardEmojiSave,
  ownsGroupCardIconSaveResult,
} from './GroupCardEmojiEditScreen';
import {
  __resetGroupCardEmojiQueueForTest,
  hasPendingGroupCardEmojis,
  preservePendingGroupCardEmoji,
  readGroupCardEmoji,
  readGroupCardEmojiResult,
  readGroupCardEmojiSaveFailure,
  retryPendingGroupCardEmojis,
  setGroupCardEmojiSaveFailure,
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
  // 직전 화면의 unmount 뒤 storage promise 후속 microtask를 먼저 비우고 mock을 복원한 다음
  // 새 테스트의 직렬 queue를 만든다. 그렇지 않으면 직전 pending callback이 reset 뒤 queue를 잡는다.
  await Promise.resolve();
  await Promise.resolve();
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  __resetGroupCardEmojiQueueForTest();
  jest.clearAllMocks();
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

test('저장 성공은 현재 계정에 남은 pending을 기준으로 실패 상태를 다시 계산한다', async () => {
  setGroupCardEmojiSaveFailure('user-1', true);
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));

  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(readGroupCardEmojiSaveFailure('user-1')).toBe(false);
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

test('저장 실패 뒤 다른 아이콘을 고르면 최신 선택을 즉시 다시 저장한다', async () => {
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.📚')));
  setGroupCardEmojiSaveFailure('user-1', true);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));
  expect(await screen.findByText(/내 카드 아이콘을 저장하지 못했어요/)).toBeOnTheScreen();

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));

  await waitFor(() => expect(screen.queryByText(/내 카드 아이콘을 저장하지 못했어요/)).toBeNull());
  expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🔥');
  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(logGroupCardIconSaveResult).toHaveBeenNthCalledWith(2, {
    surface: 'settings',
    result: 'success',
  });
  expect(readGroupCardEmojiSaveFailure('user-1')).toBe(false);
});

test('수동 저장 실패 전에 예약된 재시도 성공을 새 pending 세대로 되살리지 않는다', async () => {
  let started: () => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const startedGate = new Promise<void>((resolve) => (started = resolve));
  const firstWrite = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async () => {
    started();
    await firstWrite;
  });
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.📚')));
  fireEvent.press(screen.getByTestId('group.cardEmoji.save'));
  await startedGate;

  const retry = retryPendingGroupCardEmojis('user-1', ['group-1']);
  await act(async () => reject(new Error('disk full')));
  await retry;

  expect(await retryPendingGroupCardEmojis('user-1', ['group-1'])).toEqual({});
});

test('저장 실패 뒤 선택 변경 자동 재시도도 실패 결과를 계측한다', async () => {
  await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.📚')));
  jest
    .spyOn(AsyncStorage, 'setItem')
    .mockRejectedValueOnce(new Error('disk full'))
    .mockRejectedValueOnce(new Error('still full'));
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.save')));
  expect(await screen.findByText(/내 카드 아이콘을 저장하지 못했어요/)).toBeOnTheScreen();

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));

  await waitFor(() => expect(logGroupCardIconSaveResult).toHaveBeenCalledTimes(2));
  expect(logGroupCardIconSaveResult).toHaveBeenNthCalledWith(2, {
    surface: 'settings',
    result: 'failed',
  });
  expect(screen.getByTestId('group.cardEmoji.🔥').props.accessibilityState.selected).toBe(true);
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
  setGroupCardEmojiSaveFailure('user-1', true);

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🎯')));
  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
  expect(await retryPendingGroupCardEmojis('user-1', ['group-1'])).toEqual({});
  expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🎯');
  expect(readGroupCardEmojiSaveFailure('user-1')).toBe(false);
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

test('기본값 🎯 pending도 디스크 기본값과 같다고 숨기지 않고 재시도할 수 있다', async () => {
  preservePendingGroupCardEmoji('user-1', 'group-1', '🎯');
  await render(<GroupCardEmojiEditScreen />);

  await waitFor(() => expect(screen.getByTestId('group.cardEmoji.🎯')).not.toBeDisabled());
  expect(screen.getByTestId('group.cardEmoji.save')).not.toBeDisabled();
});

test('pending으로 다시 연 편집기에서 다른 아이콘을 고르면 버튼 탭 없이 최신 선택을 저장한다', async () => {
  await writeGroupCardEmoji('user-1', 'group-1', '🎯');
  preservePendingGroupCardEmoji('user-1', 'group-1', '📚');
  await render(<GroupCardEmojiEditScreen />);
  await waitFor(() =>
    expect(screen.getByTestId('group.cardEmoji.📚').props.accessibilityState.selected).toBe(true),
  );

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🔥')));

  await waitFor(async () =>
    expect(await readGroupCardEmojiResult('user-1', 'group-1')).toEqual({
      status: 'ready',
      emoji: '🔥',
      storedEmoji: '🔥',
      pending: false,
    }),
  );
  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
  expect(logGroupCardIconSaveResult).toHaveBeenCalledWith({
    surface: 'settings',
    result: 'success',
  });
});

test('pending 선택 변경의 자동 저장 중에는 picker와 저장 버튼을 함께 잠근다', async () => {
  await writeGroupCardEmoji('user-1', 'group-1', '🎯');
  preservePendingGroupCardEmoji('user-1', 'group-1', '📚');
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const setItem = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    await gate;
    await AsyncStorage.multiSet([[key, value]]);
  });
  setItem.mockClear();
  await render(<GroupCardEmojiEditScreen />);
  await waitFor(() =>
    expect(screen.getByTestId('group.cardEmoji.📚').props.accessibilityState.selected).toBe(true),
  );

  fireEvent.press(screen.getByTestId('group.cardEmoji.🔥'));

  await waitFor(() => expect(screen.getByTestId('group.cardEmoji.📚')).toBeDisabled());
  expect(screen.getByTestId('group.cardEmoji.save').props.accessibilityState).toEqual(
    expect.objectContaining({ busy: true, disabled: true }),
  );

  await act(async () => release());
  await waitFor(() => expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled());
  expect(setItem).toHaveBeenCalledTimes(1);
});

test('pending을 합성해 다시 연 편집기에서 디스크 기준값을 고르면 재시도를 취소한다', async () => {
  await writeGroupCardEmoji('user-1', 'group-1', '🎯');
  preservePendingGroupCardEmoji('user-1', 'group-1', '📚');
  await render(<GroupCardEmojiEditScreen />);
  await waitFor(() =>
    expect(screen.getByTestId('group.cardEmoji.📚').props.accessibilityState.selected).toBe(true),
  );

  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.🎯')));

  expect(screen.getByTestId('group.cardEmoji.save')).toBeDisabled();
  expect(await retryPendingGroupCardEmojis('user-1', ['group-1'])).toEqual({});
  expect(await readGroupCardEmoji('user-1', 'group-1')).toBe('🎯');
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

  await act(async () => {
    release();
    await gate;
  });
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

test('저장 중 화면이 먼저 unmount된 뒤 실패해도 계정 실패 상태와 pending을 유지한다', async () => {
  let reject: (reason: Error) => void = () => undefined;
  const gate = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  const view = await render(<GroupCardEmojiEditScreen />);
  await screen.findByTestId('group.cardEmoji.save');
  await act(async () => fireEvent.press(screen.getByTestId('group.cardEmoji.📚')));
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async () => gate);
  fireEvent.press(screen.getByTestId('group.cardEmoji.save'));
  await waitFor(() => expect(screen.getByTestId('group.cardEmoji.🔥')).toBeDisabled());

  view.unmount();
  await act(async () => {
    reject(new Error('disk full'));
    await gate.catch(() => undefined);
    await Promise.resolve();
  });

  expect(mockGoBack).not.toHaveBeenCalled();
  expect(readGroupCardEmojiSaveFailure('user-1')).toBe(true);
  expect(hasPendingGroupCardEmojis('user-1', ['group-1'])).toBe(true);
});
