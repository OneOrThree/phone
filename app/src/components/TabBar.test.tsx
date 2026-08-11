// 탭바 피드백 정책 + 접근성 테스트 — "선택된 탭은 아무 반응도 없다"는 규칙을 고정한다.
// (동작이 없는 버튼에 소리·햅틱·스케일이 남으면 피드백 언어가 어긋난다)
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TabBar } from './TabBar';
import { playTapSound } from '@/utils/sound';
import { hapticSelect } from '@/utils/haptics';

jest.mock('@/utils/sound', () => ({ playTapSound: jest.fn(), preloadTapSound: jest.fn() }));
jest.mock('@/utils/haptics', () => ({
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticSelect: jest.fn(),
}));
// 네비게이션 컨테이너·세이프에어리어 없이 탭바만 떼어 렌더한다
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// (리퀴드 글래스 폴백 고정은 jest.setup.js가 @callstack/liquid-glass를 통째로 스텁해 처리한다.
//  여기서 liquidGlass.tsx를 목으로 덮으면 glassBar* 색 상수까지 undefined가 된다.)

const ROUTE_NAMES = ['홈', '리그', '그룹', '전체'] as const;

const navigate = jest.fn();
const emit = jest.fn(() => ({ defaultPrevented: false }));

async function renderTabBar(focusedIndex: number) {
  const props = {
    state: {
      index: focusedIndex,
      routes: ROUTE_NAMES.map((name) => ({ key: `${name}-key`, name })),
    },
    navigation: { navigate, emit },
  } as unknown as BottomTabBarProps;
  return await render(<TabBar {...props} />);
}

beforeEach(() => jest.clearAllMocks());

describe('TabBar 피드백 정책', () => {
  test('선택되지 않은 탭은 소리·햅틱이 난다', async () => {
    await renderTabBar(0);
    fireEvent(screen.getByTestId('tabbar.tab.리그'), 'pressIn');
    expect(playTapSound).toHaveBeenCalledTimes(1);
    expect(hapticSelect).toHaveBeenCalledTimes(1);
  });

  test('이미 선택된 탭은 소리·햅틱이 나지 않는다', async () => {
    await renderTabBar(0);
    fireEvent(screen.getByTestId('tabbar.tab.홈'), 'pressIn');
    expect(playTapSound).not.toHaveBeenCalled();
    expect(hapticSelect).not.toHaveBeenCalled();
  });

  test('비선택 탭을 누르면 해당 라우트로 이동한다', async () => {
    await renderTabBar(0);
    fireEvent.press(screen.getByTestId('tabbar.tab.전체'));
    expect(emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: '전체-key',
      canPreventDefault: true,
    });
    expect(navigate).toHaveBeenCalledWith('전체');
  });

  test('tabPress가 취소되면 이동하지 않는다', async () => {
    emit.mockReturnValueOnce({ defaultPrevented: true });
    await renderTabBar(0);
    fireEvent.press(screen.getByTestId('tabbar.tab.그룹'));
    expect(navigate).not.toHaveBeenCalled();
  });

  test('선택된 탭을 다시 눌러도 이동하지 않는다', async () => {
    await renderTabBar(0);
    fireEvent.press(screen.getByTestId('tabbar.tab.홈'));
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('TabBar 접근성', () => {
  test('네 탭은 아이콘 아래 라벨과 44pt 이상의 터치 높이를 유지한다', async () => {
    await renderTabBar(2);
    for (const name of ROUTE_NAMES) {
      expect(screen.getByText(name)).toBeOnTheScreen();
      expect(screen.getByTestId(`tabbar.tab.${name}`)).toHaveStyle({
        minWidth: 44,
        height: 56,
      });
    }
    expect(screen.getByText('그룹')).toHaveStyle({ color: '#5E6AD2' });
  });

  test('탭 역할·선택 상태·레이블을 노출한다', async () => {
    await renderTabBar(1);
    const selected = screen.getByTestId('tabbar.tab.리그');
    const unselected = screen.getByTestId('tabbar.tab.홈');

    expect(selected.props.accessibilityRole).toBe('tab');
    expect(selected.props.accessibilityLabel).toBe('리그');
    expect(selected.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(unselected.props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
  });

  test('중앙 FAB는 버튼 역할 기본값을 갖는다', async () => {
    await renderTabBar(0);
    const fab = screen.getByTestId('tabbar.fab');
    expect(fab.props.accessibilityRole).toBe('button');
    expect(fab.props.accessibilityLabel).toBe('집중 시작');
  });
});
