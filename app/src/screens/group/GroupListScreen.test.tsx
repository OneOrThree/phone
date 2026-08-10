// GroupListScreen 렌더·콜백 테스트 — 명세 docs/app/group-plan-2.md §3-1.
//
// 여기서 잠그는 것 두 가지:
//  1) 카드가 그룹방 헤더와 같은 정보(이름·비공개·인원)를 잃지 않고, 방장 배지는 **내가 OWNER인
//     그룹에만** 붙는다. role을 뭉개면 남의 그룹에 방장 표시가 붙어 잘못된 권한을 기대하게 된다.
//  2) 이 화면은 **스스로 navigate 하지 않는다** — 탭·만들기·찾기 모두 prop 콜백으로만 나간다.
//     (1건이면 목록을 접고 2건 이상이면 push 하는 분기는 GroupScreen이 쥔다.)
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { View } from 'react-native';
import GroupListScreen from './GroupListScreen';
import { groupDeckCardWidth } from './groupDeckLayout';
import type { GroupSummaryResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
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

beforeEach(() => {
  jest.clearAllMocks();
  onRefresh.mockResolvedValue(undefined);
});

describe('카드 렌더', () => {
  test('스켈레톤과 실제 덱이 공유할 카드 폭은 화면별 동일 peek 공식을 쓴다', () => {
    expect([320, 430, 768].map(groupDeckCardWidth)).toEqual([272, 382, 720]);
  });
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
    expect(
      screen.getByLabelText('그룹 찾기, 현재 3/3 페이지', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(/아침 6시 집중방.*1 \/ 3/)).toBeOnTheScreen();
    expect(
      screen.getByTestId(`group.card.grip.${GROUP_ID}`, { includeHiddenElements: true }).props,
    ).toMatchObject({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
      pointerEvents: 'none',
    });
  });

  test('글자 확대 등으로 측정된 가장 큰 카드 높이를 끝 카드에도 공유한다', async () => {
    await renderList([group()]);

    await act(async () => {
      fireEvent(screen.getByTestId(`group.card.front.measure.${GROUP_ID}`), 'layout', {
        nativeEvent: { layout: { height: 280 } },
      });
    });

    expect(screen.getByTestId('group.deck.findMore', { includeHiddenElements: true })).toHaveStyle({
      minHeight: 620,
    });

    await act(async () => {
      fireEvent(screen.getByTestId(`group.card.front.measure.${GROUP_ID}`), 'layout', {
        nativeEvent: { layout: { height: 200 } },
      });
    });
    expect(screen.getByTestId('group.deck.findMore', { includeHiddenElements: true })).toHaveStyle({
      minHeight: 540,
    });
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
    expect(screen.getByTestId('group.list.items').props.onScrollEndDrag).toEqual(
      expect.any(Function),
    );
    expect(screen.getByTestId('group.list.scroller').props.alwaysBounceVertical).toBe(true);
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('1 / 12');
    expect(screen.getByTestId('group.deck.findMore', { includeHiddenElements: true })).toHaveStyle({
      minHeight: 520,
    });
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
  test('앞면과 뒷면 복귀 제어가 같은 요약 disclosure 상태를 노출한다', async () => {
    await renderList([group()]);
    const front = screen.getByTestId(`group.card.${GROUP_ID}`);
    expect(front.props.accessibilityState).toEqual({ expanded: false });
    expect(front.props.nativeID).toBe(`group.card.disclosure.${GROUP_ID}`);

    await press(`group.card.${GROUP_ID}`);
    const back = screen.getByTestId(`group.card.back.${GROUP_ID}`);
    const collapse = screen.getByTestId(`group.card.frontAction.${GROUP_ID}`);
    expect(back.props.nativeID).toBe(`group.card.summary.${GROUP_ID}`);
    expect(back.props.accessibilityLabelledBy).toBe(`group.card.disclosure.${GROUP_ID}`);
    expect(collapse.props.accessibilityState).toEqual({ expanded: true });
    expect(collapse.props.nativeID).toBe(`group.card.disclosure.${GROUP_ID}`);
    expect(collapse).toHaveStyle({ minWidth: 44, minHeight: 44 });
  });

  test('앞면 본문 탭은 같은 카드만 뒤집고 방 전체 보기에서만 onSelect한다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    await press(`group.card.${GROUP_ID_2}`);

    expect(
      screen.queryByTestId(`group.card.back.${GROUP_ID_2}`, { includeHiddenElements: true }),
    ).toBeNull();
    const list = screen.getByTestId('group.list.items');
    await act(async () => {
      fireEvent(list, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 400 } } });
    });
    expect(
      screen.getByTestId(`group.card.back.${GROUP_ID_2}`, { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('저녁 스터디, 2 / 3')).toBeOnTheScreen();
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('2 / 3');
    expect(onSelect).not.toHaveBeenCalled();

    await press(`group.card.room.${GROUP_ID_2}`);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(GROUP_ID_2);
    expect(
      screen.getByTestId(`group.card.room.${GROUP_ID_2}`, { includeHiddenElements: true }).props
        .accessibilityRole,
    ).toBe('button');
  });

  test('접근성 이름은 긴 서버 원문을 축약하지 않는다', async () => {
    const longName = '공백 없는 매우 긴 그룹 이름 ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    await renderList([group({ name: longName })]);

    expect(screen.getByLabelText(new RegExp(longName))).toBeOnTheScreen();
  });

  test('접근성 이름은 화면에 보이는 소개 원문도 포함한다', async () => {
    await renderList([group({ description: '매일 아침 함께 집중해요' })]);
    expect(screen.getByLabelText(/매일 아침 함께 집중해요/)).toBeOnTheScreen();
  });

  test('접근성 이름은 이모티콘의 읽을 수 있는 이름을 포함한다', async () => {
    await renderList([group()]);
    expect(screen.getByLabelText(/목표 아이콘/)).toBeOnTheScreen();
  });

  test('활성 카드만 접근성 트리에 남긴다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    expect(
      screen.getByTestId(`group.list.card.${GROUP_ID}`).props.accessibilityElementsHidden,
    ).toBe(false);
    expect(
      screen.getByTestId(`group.list.card.${GROUP_ID_2}`, { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
  });

  test('drag의 임시 offset은 무시하고 최종 target offset이 있을 때만 페이지를 확정한다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    await press(`group.card.${GROUP_ID_2}`);
    const list = screen.getByTestId('group.list.items');

    await act(async () => {
      fireEvent(list, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 400 } } });
    });

    await act(async () => {
      fireEvent(list, 'scrollEndDrag', { nativeEvent: { contentOffset: { x: 0 } } });
    });
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('2 / 3');

    await act(async () => {
      fireEvent(list, 'scrollEndDrag', {
        nativeEvent: { contentOffset: { x: 999 }, targetContentOffset: { x: 0 } },
      });
    });
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('1 / 3');
  });

  test('뒷면에서 가로 스와이프를 시작하면 즉시 앞면으로 정리한다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    await press(`group.card.${GROUP_ID}`);
    expect(screen.getByTestId(`group.card.back.${GROUP_ID}`)).toBeOnTheScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('group.list.items'), 'scrollBeginDrag');
    });

    expect(screen.queryByTestId(`group.card.back.${GROUP_ID}`)).toBeNull();
    expect(screen.getByTestId(`group.card.${GROUP_ID}`)).toBeOnTheScreen();
  });

  test('peek flip 이동 중 다른 페이지에 정착하면 보류한 flip을 폐기한다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    await press(`group.card.${GROUP_ID_2}`);
    const list = screen.getByTestId('group.list.items');

    await act(async () => {
      fireEvent(list, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 9999 } } });
    });
    await act(async () => {
      fireEvent(list, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 400 } } });
    });

    expect(
      screen.queryByTestId(`group.card.back.${GROUP_ID_2}`, { includeHiddenElements: true }),
    ).toBeNull();
  });

  test('현재 페이지 dot을 다시 눌러도 열린 뒷면을 유지한다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 400 } },
      });
    });
    await press('group.deck.indicator.dot.0');
    expect(screen.getByTestId(`group.card.back.${GROUP_ID}`)).toBeOnTheScreen();
  });

  test('열린 그룹이 목록에서 제거되면 해당 flip 상태를 영구 폐기한다', async () => {
    const a = group();
    const b = group({ groupId: GROUP_ID_2, name: '저녁 스터디' });
    const view = await renderList([a, b]);
    await press(`group.card.${GROUP_ID}`);
    expect(screen.getByTestId(`group.card.back.${GROUP_ID}`)).toBeOnTheScreen();

    await view.rerender(
      <GroupListScreen
        groups={[b]}
        onSelect={onSelect}
        onCreate={onCreate}
        onFind={onFind}
        onRefresh={onRefresh}
      />,
    );
    await view.rerender(
      <GroupListScreen
        groups={[a, b]}
        onSelect={onSelect}
        onCreate={onCreate}
        onFind={onFind}
        onRefresh={onRefresh}
      />,
    );

    expect(
      screen.queryByTestId(`group.card.back.${GROUP_ID}`, { includeHiddenElements: true }),
    ).toBeNull();
  });

  test('하단 CTA 2개는 각각 onCreate·onFind로만 나간다', async () => {
    await renderList([group()]);

    expect(
      within(screen.getByTestId('group.list.scroller')).queryByTestId('group.list.footer'),
    ).toBeNull();

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

  test('당겨서 새로고침 — 조회가 끝날 때까지만 인디케이터를 세운다', async () => {
    // 조회가 끝나는 시점을 테스트가 쥔다 — 인디케이터가 '도는 동안'과 '끝난 뒤'를 나눠 본다.
    let finish!: () => void;
    onRefresh.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await renderList([group()]);

    // RefreshControl은 리스트의 자식이라 fireEvent가 위로 훑어 찾지 못한다(RNTL 14는 UNSAFE_*
    // 쿼리도 없다) — FlatList에 넘긴 요소를 리스트 props에서 직접 집는다.
    const control = () => screen.getByTestId('group.list.scroller').props.refreshControl.props;
    expect(control().refreshing).toBe(false);

    await act(async () => {
      control().onRefresh();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(control().refreshing).toBe(true);

    // 끝나면 반드시 내린다 — 안 내리면 스피너가 영구히 남는다.
    await act(async () => {
      finish();
    });
    expect(control().refreshing).toBe(false);
  });
});
