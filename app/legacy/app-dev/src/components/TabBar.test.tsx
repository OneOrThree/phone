// 탭바 피드백 정책 + 접근성 테스트 — "선택된 탭은 아무 반응도 없다"는 규칙을 고정한다.
// (동작이 없는 버튼에 소리·햅틱·스케일이 남으면 피드백 언어가 어긋난다)
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { StyleSheet } from 'react-native';
import { TabBar } from './TabBar';
import { tabBarSafeBottom } from './tabBarLayout';
import { T } from '@/constants/theme';
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

// 이 값이 실제 레이아웃보다 작으면 탭바·FAB가 위 화면(홈 오늘 카드)을 덮는다 —
// 수식을 다시 쓰는 대신 **그려진 탭바에서 읽어** 비교한다(레이아웃만 바뀌고 수식은 안 바뀌는 드리프트 차단).
describe('TabBar 안전 여백(GROMO-1487)', () => {
  test('tabBarSafeBottom은 실제로 그려진 탭바+FAB 높이와 일치한다', async () => {
    const view = await renderTabBar(0);
    type Node = { props: { style?: unknown }; children: Node[] };
    const box = (style?: unknown) => (StyleSheet.flatten(style) ?? {}) as Record<string, number>;
    const tree = view.toJSON() as unknown as Node;

    const wrap = box(tree.props.style); // 탭바 래퍼(절대 배치, bottom:0)
    const bar = box(tree.children[0]?.props.style); // 유리 바
    const fabTop = box(screen.getByTestId('tabbar.fab').props.style).top;

    // 세이프에어리어 하단 0(목) — wrap은 최소 T.space.sm를 깔고, FAB는 바 위로 -top만큼 솟는다
    expect(tabBarSafeBottom(0)).toBe(
      wrap.paddingTop + bar.height + wrap.paddingBottom + Math.max(0, -fabTop),
    );
  });

  test('하단 인셋이 최소 여백보다 크면 그만큼 더 내려앉는다', async () => {
    expect(tabBarSafeBottom(34)).toBe(tabBarSafeBottom(0) + (34 - 8));
  });
});

describe('TabBar 접근성', () => {
  test('네 탭은 시각 라벨 없이 아이콘과 44pt 이상의 터치 영역을 유지한다', async () => {
    await renderTabBar(2);
    for (const name of ROUTE_NAMES) {
      expect(screen.queryByText(name)).toBeNull();
      const tab = screen.getByTestId(`tabbar.tab.${name}`);
      expect(tab).toHaveStyle({
        minWidth: 44,
        height: 56,
      });
      expect(screen.getByTestId(`tabbar.icon.${name}`)).toBeOnTheScreen();
    }
  });

  test('선택 아이콘은 accent, 비선택 아이콘은 muted 색을 유지한다', async () => {
    await renderTabBar(2);
    expect(screen.getByTestId('tabbar.icon.그룹')).toHaveStyle({ color: T.accent });
    expect(screen.getByTestId('tabbar.icon.홈')).toHaveStyle({ color: T.inkMuted });
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
