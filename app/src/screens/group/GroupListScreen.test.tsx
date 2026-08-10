// GroupListScreen 렌더·콜백 테스트 — 명세 docs/app/group-plan-2.md §3-1.
//
// 여기서 잠그는 것 두 가지:
//  1) 카드가 그룹방 헤더와 같은 정보(이름·비공개·인원)를 잃지 않고, 방장 배지는 **내가 OWNER인
//     그룹에만** 붙는다. role을 뭉개면 남의 그룹에 방장 표시가 붙어 잘못된 권한을 기대하게 된다.
//  2) 이 화면은 **스스로 navigate 하지 않는다** — 탭·만들기·찾기 모두 prop 콜백으로만 나간다.
//     (1건이면 목록을 접고 2건 이상이면 push 하는 분기는 GroupScreen이 쥔다.)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, View } from 'react-native';
import GroupListScreen, { GROUP_CARD_HEIGHT } from './GroupListScreen';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { getChallenges } from '@/services/groupApi';
import { getMyRanking } from '@/services/leagueApi';
import {
  logGroupCardActionClicked,
  logGroupCardDeckViewed,
  logGroupCardFlipped,
  logGroupCarouselPaged,
  logGroupFindOpened,
} from '@/services/analyticsEvents';
import { groupFocusStatusStore } from './groupFocusStatus';
import { STORAGE_KEYS } from '@/types/storage';
import * as localDate from '@/utils/localDate';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logGroupCardActionClicked: jest.fn(),
  logGroupCardDeckViewed: jest.fn(),
  logGroupCardFlipped: jest.fn(),
  logGroupCardReordered: jest.fn(),
  logGroupCarouselPaged: jest.fn(),
  logGroupFindOpened: jest.fn(),
}));

jest.mock('@/services/groupApi', () => ({
  getGroupDetail: jest.fn(async (groupId: string) => ({ id: groupId, members: [] })),
  getAnnouncements: jest.fn(async () => []),
  getChallenges: jest.fn(async () => []),
}));

jest.mock('@/services/leagueApi', () => ({ getMyRanking: jest.fn(async () => []) }));

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
const onStartFocus = jest.fn();
const onOpenSettings = jest.fn();
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
      userId="user-1"
      onSelect={onSelect}
      onStartFocus={onStartFocus}
      onOpenSettings={onOpenSettings}
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
  const target = await screen.findByTestId(testID);
  await act(async () => {
    fireEvent.press(target);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  await AsyncStorage.clear();
  groupFocusStatusStore.clearUser('user-1');
  jest.mocked(getChallenges).mockResolvedValue([]);
  jest.mocked(getMyRanking).mockResolvedValue([]);
  onRefresh.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('카드 렌더', () => {
  test('완료 key 조회와 덱 노출 기록 전에는 카드 입력을 열지 않는다', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.guideGroupDeck) {
        await gate;
        return null;
      }
      return null;
    });

    await renderList([group()]);
    expect(await screen.findByTestId('group.deck.hydrating')).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.card.${GROUP_ID}`)).toBeNull();
    expect(logGroupCardDeckViewed).not.toHaveBeenCalled();

    await act(async () => release());
    expect(await screen.findByTestId(`group.card.${GROUP_ID}`)).toBeOnTheScreen();
    expect(logGroupCardDeckViewed).toHaveBeenCalledTimes(1);
  });

  test('같은 focus episode에서 sheet 차단 상태가 바뀌어도 덱 노출을 중복 기록하지 않는다', async () => {
    const props = {
      groups: [group()],
      userId: 'user-1',
      onSelect,
      onCreate,
      onFind,
      onRefresh,
      viewEpisodeId: 7,
    };
    const { rerender } = await render(<GroupListScreen {...props} />);
    await screen.findByTestId(`group.card.${GROUP_ID}`);
    expect(logGroupCardDeckViewed).toHaveBeenCalledTimes(1);

    await rerender(<GroupListScreen {...props} guideBlocked />);
    await rerender(<GroupListScreen {...props} guideBlocked={false} />);
    await act(async () => Promise.resolve());

    expect(logGroupCardDeckViewed).toHaveBeenCalledTimes(1);
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
    expect(screen.getByTestId('group.deck.findMore')).toBeOnTheScreen();
  });

  test('그룹 수와 무관하게 찾기 카드는 정확히 한 장이고 서버 data에는 섞이지 않는다', async () => {
    const groups = Array.from({ length: 11 }, (_, index) =>
      group({ groupId: `${GROUP_ID}-${index}`, name: `그룹 ${index + 1}` }),
    );
    await renderList(groups);

    expect(screen.getAllByTestId('group.deck.findMore')).toHaveLength(1);
    expect(screen.getByTestId('group.list.items').props.data).toEqual(groups);
    expect(screen.getByTestId('group.list.items').props.horizontal).toBe(true);
    expect(screen.getByTestId('group.list.items').props.disableIntervalMomentum).toBe(true);
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('1 / 12');
    expect(GROUP_CARD_HEIGHT).toBe(300);
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

  test('peek로 마운트된 비활성 카드는 접근성 descendants와 포인터 입력을 숨긴다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    const active = screen.getByTestId(`group.list.card.${GROUP_ID}`);
    const peek = screen.getByTestId(`group.list.card.${GROUP_ID_2}`, {
      includeHiddenElements: true,
    });
    expect(active.props.importantForAccessibility).toBe('auto');
    expect(peek.props.accessibilityElementsHidden).toBe(true);
    expect(peek.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(peek.props.pointerEvents).toBe('none');
  });

  test('현재 계정의 저장 아이콘을 카드에 적용하고 미설정은 🎯로 표시한다', async () => {
    await render(
      <GroupListScreen
        groups={[group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]}
        cardEmojiByGroupId={{ [GROUP_ID]: '📚' }}
        onSelect={onSelect}
        onCreate={onCreate}
        onFind={onFind}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId(`group.list.emoji.${GROUP_ID}`)).toHaveTextContent('📚');
    expect(
      screen.getByTestId(`group.list.emoji.${GROUP_ID_2}`, { includeHiddenElements: true }),
    ).toHaveTextContent('🎯');
    expect(screen.getByTestId(`group.card.${GROUP_ID}`).props.accessibilityLabel).toContain(
      '내 카드 아이콘 책',
    );
    expect(
      screen.getByTestId(`group.card.${GROUP_ID_2}`, { includeHiddenElements: true }).props
        .accessibilityLabel,
    ).toContain('내 카드 아이콘 목표');
  });
});

describe('콜백', () => {
  test('앞면 본문 탭은 같은 카드만 뒤집고 방 전체 보기에서만 onSelect한다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    await act(async () => {
      const list = screen.getByTestId('group.list.items');
      list.props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: list.props.snapToInterval, y: 0 } },
      });
    });

    await press(`group.card.${GROUP_ID_2}`);

    expect(screen.getByTestId(`group.card.back.${GROUP_ID_2}`)).toBeOnTheScreen();
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

  test('뒷면은 기존 read API 요약과 집중·설정 행동을 실제 콜백에 연결한다', async () => {
    await renderList([group()]);

    await press(`group.card.${GROUP_ID}`);
    expect(await screen.findByText('현재 0명 집중 중')).toBeOnTheScreen();
    expect(screen.getByText('진행 중인 챌린지가 없어요')).toBeOnTheScreen();
    expect(screen.getByText('아직 공지가 없어요')).toBeOnTheScreen();

    await press(`group.card.focus.${GROUP_ID}`);
    expect(onStartFocus).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ interactionId: expect.any(String) }),
    );
  });

  test('flip 뒤 새 face를 알리고 앞면 보기 control로 접근성 포커스를 복원한다', async () => {
    const announce = jest.mocked(AccessibilityInfo.announceForAccessibility);
    await renderList([group()]);

    await press(`group.card.${GROUP_ID}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(announce).toHaveBeenCalledWith('아침 6시 집중방 방 요약이 열렸습니다');
  });

  test('KST 날짜가 바뀌면 열린 뒷면의 날짜 의존 요약과 focus를 즉시 다시 조회한다', async () => {
    jest.useFakeTimers();
    const date = jest.spyOn(localDate, 'todayStrKst').mockReturnValue('2026-08-10');
    try {
      await renderList([group()]);
      await press(`group.card.${GROUP_ID}`);
      await act(async () => Promise.resolve());
      expect(getChallenges).toHaveBeenCalledWith(GROUP_ID, '2026-08-10');

      date.mockReturnValue('2026-08-11');
      await act(async () => {
        jest.advanceTimersByTime(60_000);
        await Promise.resolve();
      });

      expect(getChallenges).toHaveBeenCalledWith(GROUP_ID, '2026-08-11');
      expect(getMyRanking).toHaveBeenCalledWith(undefined, '2026-08-11');
    } finally {
      jest.useRealTimers();
    }
  });

  test('뒷면 설정 행동은 역할별 설정 콜백에 연결한다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await press(`group.card.settings.${GROUP_ID}`);
    expect(onOpenSettings).toHaveBeenCalledWith(GROUP_ID);
  });

  test('뒷면은 ACTIVE 챌린지만 집계하고 coverage unknown을 로딩과 구분한다', async () => {
    jest.mocked(getChallenges).mockResolvedValue([
      { id: 'active', status: 'ACTIVE' },
      { id: 'inactive', status: 'INACTIVE' },
    ] as never);
    jest.mocked(getMyRanking).mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => ({
        userId: `user-${index}`,
        isFocusing: false,
      })) as never,
    );
    await renderList([group()]);

    await press(`group.card.${GROUP_ID}`);

    expect(await screen.findByText('진행 중 1개')).toBeOnTheScreen();
    expect(await screen.findByText('집중 현황을 확인할 수 없어요')).toBeOnTheScreen();
    expect(screen.queryByText('집중 현황을 확인하는 중…')).toBeNull();
  });

  test('CTA 수락은 callback과 계측에 같은 interaction ID를 전달한다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await press(`group.card.room.${GROUP_ID}`);

    expect(logGroupCardFlipped).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'card_tap', to_face: 'back' }),
    );
    const interaction = onSelect.mock.calls[0][1];
    expect(logGroupCardActionClicked).toHaveBeenCalledWith(
      expect.objectContaining({ interaction_id: interaction.interactionId }),
    );
  });

  test('화면 전환 전 CTA 연타는 첫 interaction 한 건만 수락한다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);

    await press(`group.card.focus.${GROUP_ID}`);
    await press(`group.card.focus.${GROUP_ID}`);

    expect(onStartFocus).toHaveBeenCalledTimes(1);
    expect(logGroupCardActionClicked).toHaveBeenCalledTimes(1);
  });

  test('현재 페이지 dot 재선택은 열린 뒷면을 그대로 유지한다', async () => {
    await renderList([group()]);
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'layout', {
        nativeEvent: { layout: { width: 320, height: 44, x: 0, y: 0 } },
      });
    });
    await press(`group.card.${GROUP_ID}`);
    await press('group.deck.indicator.dot.0');

    expect(screen.getByTestId(`group.card.back.${GROUP_ID}`)).toBeOnTheScreen();
  });

  test('사용자 스와이프 시작은 같은 페이지로 돌아와도 뒷면을 먼저 닫는다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);

    await act(async () => {
      screen.getByTestId('group.list.items').props.onScrollBeginDrag();
    });

    expect(screen.getByTestId(`group.card.front.${GROUP_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID}`)).toBeNull();
  });

  test('덱 끝 찾기 카드는 전용 진입점을 기록한다', async () => {
    await renderList([group()]);
    await press('group.deck.findMore');

    expect(logGroupFindOpened).toHaveBeenCalledWith({ entry_point: 'end_card' });
    expect(onFind).toHaveBeenCalledTimes(1);
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
    expect(logGroupFindOpened).toHaveBeenCalledWith({ entry_point: 'list' });
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
    const control = () => screen.getByTestId('group.list.items').props.refreshControl.props;
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

describe('제스처 중재와 재정렬', () => {
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
    expect(
      screen.getByTestId(`group.card.grip.${GROUP_ID}`).props.accessibilityValue,
    ).toEqual({ text: '2/3' });
    expect(announce).toHaveBeenCalledWith('아침 6시 집중방 카드를 2번째로 이동했습니다');
  });

  test('grip 짧은 탭은 원하는 위치를 고르는 순서 변경 메뉴를 연다', async () => {
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
    expect(screen.getByTestId(`group.card.reorderOptions.${GROUP_ID}`).props.nestedScrollEnabled).toBe(
      true,
    );
    expect(screen.getByTestId('group.list.items').props.scrollEnabled).toBe(false);

    await press(`group.card.${GROUP_ID}`);
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID}`)).toBeNull();

    await press(`group.card.reorderTo.${GROUP_ID}.1`);
    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID_2, GROUP_ID]);
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

  test('grip 가장자리의 자동 이동은 사용자 swipe 이벤트로 기록하지 않는다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    const list = screen.getByTestId('group.list.items');
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
      grip.props.onResponderMove?.(responderEvent, { dx: 400, dy: 0, moveX: 999 });
      list.props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: list.props.snapToInterval, y: 0 } },
      });
    });

    expect(logGroupCarouselPaged).not.toHaveBeenCalled();
  });

  test('열린 순서 메뉴의 그룹이 사라지거나 화면이 blur되면 잠금을 해제한다', async () => {
    const first = group();
    const second = group({ groupId: GROUP_ID_2, name: '저녁 스터디' });
    const { rerender } = await renderList([first, second]);
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

    await rerender(
      <GroupListScreen
        groups={[second]}
        userId="user-1"
        onSelect={onSelect}
        onCreate={onCreate}
        onFind={onFind}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId('group.list.items').props.scrollEnabled).toBe(true);
    expect(screen.queryByTestId(`group.card.reorderMenu.${GROUP_ID}`)).toBeNull();
  });

  test('탭 임계값 전 edge 좌표는 페이지 이동 목표를 만들지 않는다', async () => {
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
      grip.props.onResponderMove?.(responderEvent, { dx: 2, dy: 0, moveX: 0 });
      grip.props.onResponderRelease?.(responderEvent, { dx: 7, dy: 0 });
    });

    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID, GROUP_ID_2]);
  });
});
