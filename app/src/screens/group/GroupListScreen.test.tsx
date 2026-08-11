// GroupListScreen 렌더·콜백 테스트 — 명세 docs/app/group-plan-2.md §3-1.
//
// 여기서 잠그는 것 두 가지:
//  1) 카드가 그룹방 헤더와 같은 정보(이름·비공개·인원)를 잃지 않고, 방장 배지는 **내가 OWNER인
//     그룹에만** 붙는다. role을 뭉개면 남의 그룹에 방장 표시가 붙어 잘못된 권한을 기대하게 된다.
//  2) 이 화면은 **스스로 navigate 하지 않는다** — 탭·만들기·찾기 모두 prop 콜백으로만 나간다.
//     (1건이면 목록을 접고 2건 이상이면 push 하는 분기는 GroupScreen이 쥔다.)
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, BackHandler, FlatList, View } from 'react-native';
import GroupListScreen, {
  advanceEdgeTarget,
  isProgrammaticMomentum,
  shouldClaimReorderDrag,
} from './GroupListScreen';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { STORAGE_KEYS } from '@/types/storage';
import { logGroupCardActionClicked } from '@/services/analyticsEvents';
import { resetGroupDeckGuideSessionForTests } from './groupDeckGuide';
import { tabBarSafeBottom } from '@/components/tabBarLayout';

jest.mock('@/services/analyticsEvents', () => ({
  logGroupCardActionClicked: jest.fn(),
  logGroupCardDeckViewed: jest.fn(),
  logGroupCardFlipped: jest.fn(),
  logGroupCardReordered: jest.fn(),
  logGroupCarouselPaged: jest.fn(),
  logGroupDeckGuideInterrupted: jest.fn(),
  logGroupDeckGuideReadFailed: jest.fn(),
  logGroupDeckGuideWriteFailed: jest.fn(),
  logTabGuideCompleted: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('./useGroupCardData', () => ({
  useGroupCardData: () => ({ snapshots: {}, ensureBack: jest.fn(), retry: jest.fn() }),
}));

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const GROUP_ID_2 = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d66';

function group(over: Partial<GroupSummaryResponse> = {}): GroupSummaryResponse {
  return {
    groupId: GROUP_ID,
    name: '아침 6시 집중방',
    code: null,
    currentMembers: 2,
    maxMembers: 5,
    role: 'MEMBER',
    status: 'WAITING',
    ...over,
  };
}

const onSelect = jest.fn();
const onCreate = jest.fn();
const onFind = jest.fn();
const onRefresh = jest.fn<Promise<void>, []>();
const onBack = jest.fn();

// render는 반드시 await 한다 — React 19 + RNTL 14에서는 렌더가 비동기라
// 동기 호출만 하면 screen이 채워지지 않는다(그룹 테스트 3종 공통 관행).
async function renderList(
  groups: GroupSummaryResponse[],
  back?: () => void,
  userId: string | null = null,
) {
  return await render(
    <GroupListScreen
      groups={groups}
      userId={userId}
      onSelect={onSelect}
      onCreate={onCreate}
      onFind={onFind}
      onRefresh={onRefresh}
      onBack={back}
    />,
  );
}

// 탭은 act로 감싼다 — 감싸지 않으면 fireEvent가 여는 act 스코프가 렌더 스코프와 겹쳐
// ("overlapping act() calls") 다음 테스트의 렌더가 통째로 비는 일이 생긴다.
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID, { includeHiddenElements: true }));
  });
}

async function finishCardFlip() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 310));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  onRefresh.mockResolvedValue(undefined);
});

describe('카드 렌더', () => {
  test('안내 중 blocking overlay가 생긴 render에서는 가이드 Modal을 즉시 내린다', async () => {
    resetGroupDeckGuideSessionForTests();
    await AsyncStorage.removeItem(STORAGE_KEYS.guideGroupDeck);
    const props = {
      groups: [group()],
      onSelect,
      onCreate,
      onFind,
      onRefresh,
      userId: 'user-1',
      guideEpisode: 1,
      guideDataReady: true,
    };
    const view = await render(<GroupListScreen {...props} />);

    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.guideAnchor'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 520 } },
      });
      fireEvent(screen.getByTestId(`group.list.card.${GROUP_ID}`), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 520 } },
      });
    });
    await waitFor(() => expect(screen.getByTestId('group.list.guide')).toBeOnTheScreen());

    await view.rerender(<GroupListScreen {...props} guideBlocked />);
    expect(screen.queryByTestId('group.list.guide')).toBeNull();
  });

  test('로컬 순서를 읽기 전에는 서버 첫 카드를 노출하지 않고 hydrate된 0번부터 시작한다', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.groupCardOrder,
      JSON.stringify({ 'user-1': [GROUP_ID_2, GROUP_ID] }),
    );
    const storedOrder = await AsyncStorage.getItem(STORAGE_KEYS.groupCardOrder);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.groupCardOrder) await gate;
      return key === STORAGE_KEYS.groupCardOrder ? storedOrder : null;
    });

    await renderList(
      [group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })],
      undefined,
      'user-1',
    );
    expect(
      screen.getByTestId('group.deck.hydrating', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('group.list.items')).toBeNull();

    release();
    await waitFor(() => expect(screen.getByTestId('group.list.items')).toBeOnTheScreen());
    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID_2, GROUP_ID]);
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('1 / 3');
  });

  test('이름과 n/m 인원을 서버가 준 순서 그대로 그린다', async () => {
    await renderList([
      group(),
      group({ groupId: GROUP_ID_2, name: '저녁 스터디', currentMembers: 4 }),
    ]);

    expect(screen.getByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.getByText('2/5')).toBeOnTheScreen();
    expect(
      screen.getAllByText('저녁 스터디', { includeHiddenElements: true }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('4/5', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId(`group.card.front.${GROUP_ID}`)).toHaveStyle({
      shadowOpacity: 0.16,
      elevation: 5,
    });
    expect(screen.getByTestId(`group.card.frontInfo.${GROUP_ID}`).props).toMatchObject({
      nestedScrollEnabled: true,
    });
    expect(
      screen.getByTestId(`group.card.frontInfo.${GROUP_ID}`).props.contentContainerStyle,
    ).toEqual(expect.objectContaining({ flexGrow: 1 }));
    expect(
      screen.getByTestId('group.deck.findMore', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  test('그룹 수와 무관하게 찾기 카드는 정확히 한 장이고 서버 data에는 섞이지 않는다', async () => {
    const groups = Array.from({ length: 11 }, (_, index) =>
      group({ groupId: `${GROUP_ID}-${index}`, name: `그룹 ${index + 1}` }),
    );
    await renderList(groups);

    expect(
      screen.getAllByTestId('group.deck.findMore', { includeHiddenElements: true }),
    ).toHaveLength(1);
    expect(screen.getByTestId('group.list.items').props.data).toEqual(groups);
    expect(screen.getByTestId('group.list.items').props.horizontal).toBe(true);
    expect(screen.getByTestId('group.list.items').props.disableIntervalMomentum).toBe(true);
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('1 / 12');
  });

  test('자물쇠는 비공개 그룹에만, 방장 표시는 내가 OWNER인 그룹에만 붙는다', async () => {
    await renderList([
      group({ isPrivate: true, role: 'OWNER' }),
      group({ groupId: GROUP_ID_2, name: '저녁 스터디', isPrivate: false, role: 'MEMBER' }),
    ]);

    expect(screen.getByText('비밀방')).toBeOnTheScreen();
    expect(screen.getAllByText('방장')).toHaveLength(1);
  });

  test('공개·일반 멤버 그룹뿐이면 자물쇠도 방장 배지도 없다', async () => {
    await renderList([group({ isPrivate: false, role: 'MEMBER' })]);

    expect(screen.queryByText('비밀방')).toBeNull();
    expect(screen.queryByText('방장')).toBeNull();
  });
});

describe('콜백', () => {
  test('앞·뒷면 모두 시각 전환 문구를 표시하지 않는다', async () => {
    await renderList([group()]);

    expect(screen.queryByText('뒤집어 방 보기')).toBeNull();
    await press(`group.card.${GROUP_ID}`);
    await finishCardFlip();
    expect(screen.queryByText('앞면으로')).toBeNull();
  });

  test('빠른 연타에도 완료 면만 한 번씩 알리고 뒷면 기본 활성화로 복귀한다', async () => {
    const announce = jest.mocked(AccessibilityInfo.announceForAccessibility);
    await renderList([group()]);

    const front = screen.getByTestId(`group.card.${GROUP_ID}`);
    await act(async () => {
      fireEvent.press(front);
      fireEvent.press(front);
    });
    expect(announce).not.toHaveBeenCalled();
    await finishCardFlip();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('아침 6시 집중방 카드 뒷면입니다');

    await act(async () => {
      const backTitle = screen.getByTestId(`group.card.backTitle.${GROUP_ID}`);
      fireEvent(backTitle, 'accessibilityTap');
      fireEvent(backTitle, 'accessibilityTap');
    });
    await finishCardFlip();
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith('아침 6시 집중방 카드 앞면입니다');
  });

  test('앞면 본문 탭은 같은 카드만 뒤집고 방 전체 보기에서만 onSelect한다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    await press(`group.card.${GROUP_ID_2}`);

    expect(screen.queryByTestId(`group.card.back.${GROUP_ID_2}`)).toBeNull();
    await act(async () => {
      fireEvent(screen.getByTestId('group.list.items'), 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: 400 } },
      });
    });
    expect(
      screen.getByTestId(`group.card.back.${GROUP_ID_2}`, { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(onSelect).not.toHaveBeenCalled();

    await finishCardFlip();
    await press(`group.card.room.${GROUP_ID_2}`);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      GROUP_ID_2,
      expect.objectContaining({
        interactionId: expect.any(String),
        interactionAcceptedAt: expect.any(Number),
      }),
    );
  });

  test('뒷면 CTA 연타는 첫 interaction과 navigation만 수락한다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await finishCardFlip();

    await press(`group.card.room.${GROUP_ID}`);
    await press(`group.card.room.${GROUP_ID}`);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test('guide가 연 뒷면은 같은 페이지 스냅·설정 복귀 후에도 back_source를 유지한다', async () => {
    resetGroupDeckGuideSessionForTests();
    const onOpenSettings = jest.fn();
    const props = {
      groups: [group()],
      userId: 'user-1',
      onSelect,
      onCreate,
      onFind,
      onOpenSettings,
      onRefresh,
      guideEpisode: 1,
    };
    const view = await render(<GroupListScreen {...props} isScreenFocused />);

    await waitFor(() => expect(screen.getByTestId('group.list.items')).toBeOnTheScreen());
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.guideAnchor'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 520 } },
      });
      fireEvent(screen.getByTestId(`group.list.card.${GROUP_ID}`), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 352, height: 520 } },
      });
    });
    await waitFor(() => expect(screen.getByTestId('group.list.guide')).toBeOnTheScreen());

    await press('group.list.guide');
    await press('group.list.guide');
    await press('group.list.guide');
    await waitFor(() =>
      expect(
        screen.getByTestId(`group.card.back.${GROUP_ID}`, { includeHiddenElements: true }),
      ).toBeOnTheScreen(),
    );
    await press('group.list.guide');
    await waitFor(() => expect(screen.queryByTestId('group.list.guide')).toBeNull());
    await finishCardFlip();

    await act(async () => {
      fireEvent(screen.getByTestId('group.list.items'), 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: 8 } },
      });
    });
    expect(
      screen.getByTestId(`group.card.back.${GROUP_ID}`, { includeHiddenElements: true }),
    ).toBeOnTheScreen();

    await press(`group.card.settings.${GROUP_ID}`);
    expect(onOpenSettings).toHaveBeenCalledWith(GROUP_ID);
    await view.rerender(<GroupListScreen {...props} isScreenFocused={false} />);
    await view.rerender(<GroupListScreen {...props} isScreenFocused />);
    await press(`group.card.room.${GROUP_ID}`);

    const actionEvents = (logGroupCardActionClicked as jest.Mock).mock.calls;
    expect(actionEvents).toEqual([
      [expect.objectContaining({ action: 'settings', back_source: 'guide' })],
      [expect.objectContaining({ action: 'room', back_source: 'guide' })],
    ]);
  });

  test('사용자 스와이프 시작은 같은 페이지로 돌아와도 열린 뒷면을 즉시 닫는다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await finishCardFlip();

    await act(async () => {
      fireEvent(screen.getByTestId('group.list.items'), 'scrollBeginDrag', {
        nativeEvent: { contentOffset: { x: 0 } },
      });
    });

    expect(screen.getByTestId(`group.card.front.${GROUP_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID}`)).toBeNull();
    expect(screen.getByTestId('group.list.items').props.scrollEnabled).toBe(true);
    expect(screen.getByTestId('group.deck.guideAnchor').props.pointerEvents).toBe('auto');
  });

  test('접근성 이름은 긴 서버 원문을 축약하지 않는다', async () => {
    const longName = '공백 없는 매우 긴 그룹 이름 ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    await renderList([group({ name: longName })]);

    expect(screen.getAllByLabelText(new RegExp(longName)).length).toBeGreaterThan(0);
  });

  test('앞면 접근성 이름은 화면에 표시한 소개 원문을 포함한다', async () => {
    await renderList([group({ description: '매일 아침 함께 집중해요' })]);
    expect(screen.getByLabelText(/매일 아침 함께 집중해요/)).toBeOnTheScreen();
  });

  test('헤더 CTA 2개는 각각 onCreate·onFind로만 나간다', async () => {
    await renderList([group()]);

    await press('group.list.create');
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onFind).not.toHaveBeenCalled();

    await press('group.list.find');
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  // 그룹 1건에서 ⋯ 메뉴로 '잠깐 열어 본' 목록은 되돌아갈 길이 카드 탭뿐이었다 —
  // 백버튼이 없으면 목록이 그룹 탭에 눌러앉는다(탭을 옮겼다 와도 안 풀린다).
  // 반대로 2건 이상의 기본 목록에 백버튼이 생기면 갈 곳 없는 버튼이 된다.
  test('onBack을 받았을 때만 헤더 백버튼을 그린다', async () => {
    await renderList([group()], onBack);

    await press('group.list.back');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('onBack이 없으면 백버튼 자체가 없다(기본 목록)', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    expect(screen.queryByTestId('group.list.back')).toBeNull();
  });

  // 진입 시차를 붙이려고 셀 래퍼(FlatList 기본 View)를 Animated.View로 갈아끼웠다 —
  // 그 과정에서 VirtualizedList가 넘기는 props를 삼키면 안 된다. 특히 onFocusCapture는
  // 마지막 포커스 셀을 가상화 렌더 영역에 유지하는 경로라, 잃으면 스크롤·갱신 때
  // 스크린리더/키보드 포커스가 사라진다.
  test('셀 래퍼는 VirtualizedList가 넘긴 props(onFocusCapture 포함)를 그대로 전달한다', async () => {
    await renderList([group()]);
    // 셀 래퍼는 리스트 내부가 그리는 노드라 트리에서 직접 집기 어렵다 —
    // RefreshControl과 같은 방식으로 리스트 props에서 컴포넌트를 꺼내 직접 렌더한다.
    const Cell = screen.getByTestId('group.list.items').props.CellRendererComponent;
    const onFocusCapture = jest.fn();
    const onLayout = jest.fn();

    await render(
      <Cell index={0} cellKey="c0" item={group()} onFocusCapture={onFocusCapture} testID="cell">
        <View testID="cell.child" />
      </Cell>,
    );

    expect(screen.getByTestId('cell').props.onFocusCapture).toBe(onFocusCapture);
    expect(screen.getByTestId('cell.child')).toBeOnTheScreen();

    await render(
      <Cell index={0} onLayout={onLayout} testID="cell2">
        <View />
      </Cell>,
    );
    expect(screen.getByTestId('cell2').props.onLayout).toBe(onLayout);
  });

  // 진입 시차는 인덱스별로 캐싱된 스타일 객체이고 Reanimated CSS는 참조 동등성으로 재시작을
  // 판단한다 — 재조회로 목록 순서가 바뀔 때 살아남은 카드가 이유 없이 다시 떠오르지 않도록
  // 셀은 마운트 시점 인덱스를 붙들어야 한다.
  // (reanimated가 CSS 프로퍼티를 style에서 걷어내므로 단언은 jestInlineStyle로 한다.)
  test('셀 진입 시차는 마운트 시점 자리에 고정된다(목록 순서가 바뀌어도 재생 없음)', async () => {
    await renderList([group()]);
    const Cell = screen.getByTestId('group.list.items').props.CellRendererComponent;

    const { rerender } = await render(
      <Cell index={0} testID="cell">
        <View />
      </Cell>,
    );
    const delayOf = () => screen.getByTestId('cell').props.jestInlineStyle?.[1]?.animationDelay;
    const mounted = delayOf();
    expect(mounted).toBe('0ms');

    await rerender(
      <Cell index={3} testID="cell">
        <View />
      </Cell>,
    );

    expect(delayOf()).toBe(mounted);
  });

  test('가로 덱 헤더는 원형 찾기·만들기만 제공하고 큰 하단 CTA와 새로고침 버튼은 두지 않는다', async () => {
    await renderList([group()]);

    expect(screen.getByTestId('group.list.find')).toHaveStyle({ width: 44, height: 44 });
    expect(screen.getByTestId('group.list.create')).toHaveStyle({ width: 48, height: 48 });
    expect(screen.queryByTestId('group.list.refresh')).toBeNull();
  });

  test('세로 덱 scroller의 당겨서 새로고침은 중복 요청을 막고 완료 뒤 spinner를 내린다', async () => {
    let release: () => void = () => undefined;
    onRefresh.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await renderList([group()]);

    const refresh = () => screen.getByTestId('group.list.scroller').props.refreshControl;
    expect(refresh().props.refreshing).toBe(false);
    await act(async () => {
      refresh().props.onRefresh();
      refresh().props.onRefresh();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(refresh().props.refreshing).toBe(true);

    await act(async () => release());
    await waitFor(() => expect(refresh().props.refreshing).toBe(false));
  });

  test('낮은 화면에서도 카드 하단까지 스크롤하고 탭바 위 여백을 확보한다', async () => {
    await renderList([group()]);
    const scroller = screen.getByTestId('group.list.scroller');
    expect(scroller.props.scrollEnabled).toBe(true);
    expect(scroller.props.nestedScrollEnabled).toBe(true);
    // 여백은 탭바가 실제로 덮는 높이에서 파생한다(GROMO-1487) — 예전 상수 74는 FAB가 바 위로
    // 솟은 만큼을 빼먹어 마지막 카드가 FAB에 가렸다. 숫자를 다시 적으면 그 실수가 되돌아온다.
    expect(scroller.props.contentContainerStyle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paddingBottom: tabBarSafeBottom(34) }), // 목 인셋 하단 34
      ]),
    );
  });
});

describe('제스처 중재와 재정렬', () => {
  test('grip 짧은 탭은 포인터용 순서 변경 메뉴를 연다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    await press(`group.card.grip.${GROUP_ID}`);

    expect(screen.getByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeOnTheScreen();
    expect(screen.getByTestId('group.list.items').props.scrollEnabled).toBe(false);

    // iOS는 RefreshControl.enabled를 적용하지 않으므로 handler도 같은 잠금을 가져야 한다.
    await act(async () => {
      screen.getByTestId('group.list.scroller').props.refreshControl.props.onRefresh();
    });
    expect(onRefresh).not.toHaveBeenCalled();

    // 메뉴가 열린 동안 다른 카드·페이지·헤더 전이는 같은 포인터 episode를 가로채지 않는다.
    await press(`group.card.${GROUP_ID_2}`);
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });
    await press('group.list.create');
    await press('group.list.find');
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID_2}`)).toBeNull();
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('1 / 3');
    expect(onCreate).not.toHaveBeenCalled();
    expect(onFind).not.toHaveBeenCalled();

    await press(`group.card.reorderDone.${GROUP_ID}`);
    expect(screen.queryByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeNull();

    await press(`group.card.grip.${GROUP_ID}`);
    await press(`group.card.reorderDismiss.${GROUP_ID}`);
    expect(screen.queryByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeNull();

    await press(`group.card.grip.${GROUP_ID}`);
    await act(async () => {
      screen.getByTestId(`group.card.reorderMenu.${GROUP_ID}`).props.onAccessibilityEscape();
    });
    expect(screen.queryByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeNull();

    await press(`group.card.grip.${GROUP_ID}`);

    await press(`group.card.reorderNext.${GROUP_ID}`);
    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID_2, GROUP_ID]);
    expect(screen.getByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeOnTheScreen();
    await press(`group.card.reorderPrevious.${GROUP_ID}`);
    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID, GROUP_ID_2]);
    expect(screen.getByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeOnTheScreen();
    await press(`group.card.reorderDone.${GROUP_ID}`);
    expect(screen.queryByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeNull();
  });

  test('Android Back은 열린 순서 변경 메뉴만 닫고 상위 route로 전달하지 않는다', async () => {
    let hardwareBack: (event: never) => boolean | null | undefined = () => false;
    const remove = jest.fn();
    const backSpy = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, listener) => {
        hardwareBack = listener;
        return { remove };
      });
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    await press(`group.card.grip.${GROUP_ID}`);

    expect(screen.getByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeOnTheScreen();
    let consumed = false;
    await act(async () => {
      consumed = hardwareBack(undefined as never) === true;
    });
    expect(consumed).toBe(true);
    expect(screen.queryByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
    backSpy.mockRestore();
  });

  test('그룹이 많아도 순서 메뉴는 고정된 두 방향 한 칸 control만 제공한다', async () => {
    const groups = Array.from({ length: 11 }, (_, index) =>
      group({ groupId: `${GROUP_ID}-${index}`, name: `그룹 ${index + 1}` }),
    );
    await renderList(groups);
    await press(`group.card.grip.${groups[0].groupId}`);

    const options = screen.getByTestId(`group.card.reorderOptions.${groups[0].groupId}`);
    expect(options).toBeOnTheScreen();
    expect(
      screen.getByTestId(`group.card.reorderPrevious.${groups[0].groupId}`).props
        .accessibilityState,
    ).toEqual(expect.objectContaining({ disabled: true }));
    expect(
      screen.getByTestId(`group.card.reorderNext.${groups[0].groupId}`).props.accessibilityState,
    ).toEqual(expect.objectContaining({ disabled: false }));
    expect(screen.queryAllByTestId(/group\.card\.reorderTo\./)).toHaveLength(0);
  });

  test('가장자리 유지 tick은 현재 target을 누적해 마지막 슬롯까지 이동한다', () => {
    const first = advanceEdgeTarget(0, 1, 3);
    const second = advanceEdgeTarget(first, 1, 3);
    const third = advanceEdgeTarget(second, 1, 3);
    expect([first, second, third, advanceEdgeTarget(third, 1, 3)]).toEqual([1, 2, 3, 3]);
  });

  test('가장자리 자동 이동의 완료 offset만 programmatic momentum으로 분류한다', () => {
    expect(isProgrammaticMomentum(400, 400)).toBe(true);
    expect(isProgrammaticMomentum(400, 399.5)).toBe(true);
    expect(isProgrammaticMomentum(400, 360)).toBe(false);
    expect(isProgrammaticMomentum(null, 400)).toBe(false);
  });

  test('순서 저장 실패는 앱 재실행 시 이전 순서로 돌아갈 수 있음을 알린다', async () => {
    await renderList(
      [group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })],
      undefined,
      'save-error-user',
    );
    await waitFor(() => expect(screen.getByTestId('group.list.items')).toBeOnTheScreen());
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    const activeGroupId = screen.getByTestId('group.list.items').props.data[0].groupId;

    await act(async () => {
      fireEvent(screen.getByTestId(`group.card.grip.${activeGroupId}`), 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });

    await waitFor(() =>
      expect(screen.getByText(/앱을 다시 열면 이전 순서로 돌아갈 수 있어요/)).toBeOnTheScreen(),
    );
  });

  test('접근성 grip 동작은 순서만 한 번 바꾸고 카드를 뒤집지 않는다', async () => {
    const announce = jest.mocked(AccessibilityInfo.announceForAccessibility);
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    await act(async () => {
      fireEvent(screen.getByTestId(`group.card.grip.${GROUP_ID}`), 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });

    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID_2, GROUP_ID]);
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID}`)).toBeNull();
    expect(screen.getByTestId(`group.card.grip.${GROUP_ID}`).props.accessibilityValue).toEqual({
      text: '2/2',
    });
    expect(screen.getByTestId(`group.card.grip.${GROUP_ID}`).props.focusable).toBe(true);
    expect(announce).toHaveBeenCalledWith('아침 6시 집중방 카드를 2번째로 이동했습니다');
  });

  test('grip drag는 bubble·capture 모두 6pt 이상 이동만 소유한다', () => {
    expect(shouldClaimReorderDrag(5.9, 0)).toBe(false);
    expect(shouldClaimReorderDrag(0, -5.9)).toBe(false);
    expect(shouldClaimReorderDrag(6, 0)).toBe(true);
    expect(shouldClaimReorderDrag(0, -6)).toBe(true);
  });

  test('grip drag 취소는 순서·flip 상태를 바꾸지 않는다', async () => {
    const scrollSpy = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    scrollSpy.mockClear();
    const grip = screen.getByTestId(`group.card.gripDrag.${GROUP_ID}`);
    const responderEvent = {
      nativeEvent: {},
      touchHistory: {
        touchBank: [],
        numberActiveTouches: 0,
        indexOfSingleActiveTouch: -1,
        mostRecentTimeStamp: 0,
      },
    };

    await act(async () => {
      grip.props.onResponderGrant?.(responderEvent);
      grip.props.onResponderMove?.(responderEvent, { dx: 400, moveX: 390 });
      grip.props.onResponderTerminate?.(responderEvent, {});
    });

    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID, GROUP_ID_2]);
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID}`)).toBeNull();
    expect(scrollSpy).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  });
});
