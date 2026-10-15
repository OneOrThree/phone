import { fireEvent, render, screen } from '@testing-library/react-native';
import { GroupRoomBottomBar } from './GroupRoomBottomBar';
import { discardInitialGroupRoomReturn } from '@/navigation/groupEntrySource';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/navigation/groupEntrySource', () => ({
  discardInitialGroupRoomReturn: jest.fn(),
}));

const mockDiscardInitialGroupRoomReturn = discardInitialGroupRoomReturn as jest.MockedFunction<
  typeof discardInitialGroupRoomReturn
>;

beforeEach(() => jest.clearAllMocks());

test.each(['홈', '리그', '전체'])(
  '%s 탭 이탈은 보류된 최초 그룹 복귀 표식을 폐기한다',
  async (tab) => {
    await render(<GroupRoomBottomBar onFocusPress={jest.fn()} />);

    fireEvent.press(screen.getByTestId(`grouproom.tab.${tab}`));

    expect(mockDiscardInitialGroupRoomReturn).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: tab });
  },
);

test('그룹 집중 FAB는 그룹 흐름을 유지하므로 복귀 표식을 폐기하지 않는다', async () => {
  const onFocusPress = jest.fn();
  await render(<GroupRoomBottomBar onFocusPress={onFocusPress} />);

  fireEvent.press(screen.getByTestId('grouproom.fab'));

  expect(onFocusPress).toHaveBeenCalledTimes(1);
  expect(mockDiscardInitialGroupRoomReturn).not.toHaveBeenCalled();
});
