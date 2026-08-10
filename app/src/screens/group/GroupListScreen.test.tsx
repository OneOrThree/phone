// GroupListScreen 렌더·콜백 테스트 — 명세 docs/app/group-plan-2.md §3-1.
//
// 여기서 잠그는 것 두 가지:
//  1) 카드가 그룹방 헤더와 같은 정보(이름·비공개·인원)를 잃지 않고, 방장 배지는 **내가 OWNER인
//     그룹에만** 붙는다. role을 뭉개면 남의 그룹에 방장 표시가 붙어 잘못된 권한을 기대하게 된다.
//  2) 이 화면은 **스스로 navigate 하지 않는다** — 탭·만들기·찾기 모두 prop 콜백으로만 나간다.
//     (1건이면 목록을 접고 2건 이상이면 push 하는 분기는 GroupScreen이 쥔다.)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View } from 'react-native';
import GroupListScreen, { advanceEdgeTarget } from './GroupListScreen';
import type { GroupSummaryResponse } from '@/types/dto/group';

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
async function renderList(groups: GroupSummaryResponse[], back?: () => void) {
  return await render(
    <GroupListScreen
      groups={groups}
      userId={null}
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

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  onRefresh.mockResolvedValue(undefined);
});

describe('카드 렌더', () => {
  test('이름과 n/m 인원을 서버가 준 순서 그대로 그린다', async () => {
    await renderList([
      group(),
      group({ groupId: GROUP_ID_2, name: '저녁 스터디', currentMembers: 4 }),
    ]);

    expect(screen.getByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.getByText('2/5')).toBeOnTheScreen();
    expect(screen.getByText('저녁 스터디', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('4/5', { includeHiddenElements: true })).toBeOnTheScreen();
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

    await press(`group.card.room.${GROUP_ID}`);
    await press(`group.card.room.${GROUP_ID}`);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test('접근성 이름은 긴 서버 원문을 축약하지 않는다', async () => {
    const longName = '공백 없는 매우 긴 그룹 이름 ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    await renderList([group({ name: longName })]);

    expect(screen.getAllByLabelText(new RegExp(longName)).length).toBeGreaterThan(0);
  });

  test('하단 CTA 2개는 각각 onCreate·onFind로만 나간다', async () => {
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

  test('가로 덱에서도 헤더 새로고침을 누를 수 있고 조회 중 연타를 막는다', async () => {
    // 조회가 끝나는 시점을 테스트가 쥔다 — 인디케이터가 '도는 동안'과 '끝난 뒤'를 나눠 본다.
    let finish!: () => void;
    onRefresh.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await renderList([group()]);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.list.refresh'));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.list.refresh'));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // 끝나면 반드시 내린다 — 안 내리면 스피너가 영구히 남는다.
    await act(async () => {
      finish();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.list.refresh'));
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});

describe('제스처 중재와 재정렬', () => {
  test('grip 짧은 탭은 포인터용 순서 변경 메뉴를 연다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    const grip = screen.getByTestId(`group.card.grip.${GROUP_ID}`);
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
      grip.props.onResponderRelease?.(responderEvent, { dx: 0, dy: 0 });
    });

    expect(screen.getByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeOnTheScreen();
    await press(`group.card.reorderTo.${GROUP_ID}.1`);
    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID_2, GROUP_ID]);
  });

  test('가장자리 유지 tick은 현재 target을 누적해 마지막 슬롯까지 이동한다', () => {
    const first = advanceEdgeTarget(0, 1, 3);
    const second = advanceEdgeTarget(first, 1, 3);
    const third = advanceEdgeTarget(second, 1, 3);
    expect([first, second, third, advanceEdgeTarget(third, 1, 3)]).toEqual([1, 2, 3, 3]);
  });

  test('접근성 grip 동작은 순서만 한 번 바꾸고 카드를 뒤집지 않는다', async () => {
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
  });

  test('grip drag 취소는 순서·flip 상태를 바꾸지 않는다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    const grip = screen.getByTestId(`group.card.grip.${GROUP_ID}`);
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
  });
});
