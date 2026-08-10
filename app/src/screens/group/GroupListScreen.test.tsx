// GroupListScreen 렌더·콜백 테스트 — 명세 docs/app/group-plan-2.md §3-1.
//
// 여기서 잠그는 것 두 가지:
//  1) 카드가 그룹방 헤더와 같은 정보(이름·비공개·인원)를 잃지 않고, 방장 배지는 **내가 OWNER인
//     그룹에만** 붙는다. role을 뭉개면 남의 그룹에 방장 표시가 붙어 잘못된 권한을 기대하게 된다.
//  2) 이 화면은 **스스로 navigate 하지 않는다** — 탭·만들기·찾기 모두 prop 콜백으로만 나간다.
//     (1건이면 목록을 접고 2건 이상이면 push 하는 분기는 GroupScreen이 쥔다.)
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View } from 'react-native';
import GroupListScreen, { resolveDragTarget } from './GroupListScreen';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { writeGroupCardEmoji } from './groupCardEmojiStore';
import { resetGroupDeckGuideSessionForTests } from './groupDeckGuide';
import { STORAGE_KEYS } from '@/types/storage';
import { getAnnouncements, getChallenges, getGroupDetail } from '@/services/groupApi';
import { getMyRanking } from '@/services/leagueApi';
import {
  logGroupCardActionClicked,
  logGroupCardDeckViewed,
  logGroupCardFlipped,
  logGroupCardReordered,
} from '@/services/analyticsEvents';

jest.mock('@/services/groupApi', () => ({
  getGroupDetail: jest.fn(),
  getAnnouncements: jest.fn(),
  getChallenges: jest.fn(),
}));
jest.mock('@/services/leagueApi', () => ({ getMyRanking: jest.fn() }));
jest.mock('@/services/analyticsEvents', () => ({
  logGroupCardActionClicked: jest.fn(),
  logGroupCardDeckViewed: jest.fn(),
  logGroupCardFlipped: jest.fn(),
  logGroupCardReordered: jest.fn(),
  logGroupCarouselPaged: jest.fn(),
  logGroupDeckGuideReadFailed: jest.fn(),
  logGroupDeckGuideWriteFailed: jest.fn(),
  logTabGuideCompleted: jest.fn(),
}));

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
const onFocus = jest.fn();
const onSettings = jest.fn();
const onCreate = jest.fn();
const onFind = jest.fn();
const onRefresh = jest.fn<Promise<void>, []>();
const onBack = jest.fn();

// render는 반드시 await 한다 — React 19 + RNTL 14에서는 렌더가 비동기라
// 동기 호출만 하면 screen이 채워지지 않는다(그룹 테스트 3종 공통 관행).
async function renderList(
  groups: GroupSummaryResponse[],
  back?: () => void,
  userId = 'user-1',
  waitHydrated = true,
  guideBlocked = false,
) {
  const result = await render(
    <GroupListScreen
      groups={groups}
      userId={userId}
      onSelect={onSelect}
      onFocus={onFocus}
      onSettings={onSettings}
      viewEpisodeId={1}
      groupEntry="tab"
      guideBlocked={guideBlocked}
      onCreate={onCreate}
      onFind={onFind}
      onRefresh={onRefresh}
      onBack={back}
    />,
  );
  if (waitHydrated) await waitFor(() => expect(screen.getByTestId('group.list')).toBeOnTheScreen());
  else await waitFor(() => expect(screen.getByTestId('group.deck.loading')).toBeOnTheScreen());
  return result;
}

// 탭은 act로 감싼다 — 감싸지 않으면 fireEvent가 여는 act 스코프가 렌더 스코프와 겹쳐
// ("overlapping act() calls") 다음 테스트의 렌더가 통째로 비는 일이 생긴다.
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID, { includeHiddenElements: true }));
  });
}

const readStoredItem = async (key: string): Promise<string | null> => {
  const values = await AsyncStorage.multiGet([key]);
  return values[0]?.[1] ?? null;
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockImplementation(readStoredItem);
  await AsyncStorage.clear();
  resetGroupDeckGuideSessionForTests();
  await AsyncStorage.setItem(STORAGE_KEYS.guideGroupDeck, '1');
  onRefresh.mockResolvedValue(undefined);
  jest.mocked(getGroupDetail).mockResolvedValue({ members: [] } as never);
  jest.mocked(getAnnouncements).mockResolvedValue([]);
  jest.mocked(getChallenges).mockResolvedValue([]);
  jest.mocked(getMyRanking).mockResolvedValue([]);
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
    expect(logGroupCardDeckViewed).toHaveBeenCalledWith({
      group_count_bucket: '11_plus',
      group_entry: 'tab',
      guide_state: 'completed',
    });
  });

  test('미완료 key는 실제 queue 획득 상태인 shown으로 노출하고 안내를 연다', async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.guideGroupDeck);
    resetGroupDeckGuideSessionForTests();

    await renderList([group()]);

    expect(logGroupCardDeckViewed).toHaveBeenCalledWith({
      group_count_bucket: '1',
      group_entry: 'tab',
      guide_state: 'shown',
    });
    await waitFor(() => expect(screen.getByTestId('group.deck.guide')).toBeOnTheScreen());
    expect(screen.getByTestId('group.deck.guide').props.accessibilityLabel).toMatch(
      /^단계 1\/4\..*다음$/,
    );
  });

  test('안내 4단계 진입 전에 활성 카드 뒷면과 lazy dependency를 연다', async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.guideGroupDeck);
    resetGroupDeckGuideSessionForTests();
    await renderList([group()], undefined, 'guide-user');

    await press('group.deck.guide');
    await press('group.deck.guide');
    await press('group.deck.guide');

    await waitFor(() =>
      expect(screen.getByTestId(`group.card.back.${GROUP_ID}`)).toBeOnTheScreen(),
    );
    expect(getGroupDetail).toHaveBeenCalledWith(GROUP_ID, expect.any(String));
    expect(getMyRanking).toHaveBeenCalledWith(undefined, expect.any(String));
    expect(screen.getByTestId('group.deck.guide').props.accessibilityLabel).toMatch(
      /^단계 4\/4\..*시작$/,
    );

    await press('group.deck.guide');
    await press(`group.card.room.${GROUP_ID}`);
    expect(logGroupCardActionClicked).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'room', back_source: 'guide' }),
    );
  });

  test('4단계 시연 중 안내가 가려지면 다시 시작할 앞면으로 복원한다', async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.guideGroupDeck);
    resetGroupDeckGuideSessionForTests();
    const view = await renderList([group()], undefined, 'guide-interrupted');

    await press('group.deck.guide');
    await press('group.deck.guide');
    await press('group.deck.guide');
    expect(screen.getByTestId(`group.card.back.${GROUP_ID}`)).toBeOnTheScreen();

    await view.rerender(
      <GroupListScreen
        groups={[group()]}
        userId="guide-interrupted"
        onSelect={onSelect}
        onFocus={onFocus}
        onSettings={onSettings}
        viewEpisodeId={1}
        groupEntry="tab"
        guideBlocked
        onCreate={onCreate}
        onFind={onFind}
        onRefresh={onRefresh}
      />,
    );

    await waitFor(() => expect(screen.getByTestId(`group.card.${GROUP_ID}`)).toBeOnTheScreen());
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID}`)).toBeNull();
  });

  test('route blur는 이전 안내 queue를 폐기하고 다음 안정된 episode에서 다시 판정한다', async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.guideGroupDeck);
    resetGroupDeckGuideSessionForTests();
    const props = {
      groups: [group()],
      userId: 'guide-blur',
      onSelect,
      onFocus,
      onSettings,
      groupEntry: 'tab' as const,
      onCreate,
      onFind,
      onRefresh,
    };
    const view = await render(<GroupListScreen {...props} viewEpisodeId={1} guideScreenFocused />);
    await waitFor(() => expect(screen.getByTestId('group.deck.guide')).toBeOnTheScreen());

    await view.rerender(
      <GroupListScreen {...props} viewEpisodeId={1} guideScreenFocused={false} />,
    );
    expect(screen.queryByTestId('group.deck.guide')).toBeNull();

    await view.rerender(<GroupListScreen {...props} viewEpisodeId={1} guideScreenFocused />);
    expect(screen.queryByTestId('group.deck.guide')).toBeNull();

    await view.rerender(<GroupListScreen {...props} viewEpisodeId={2} guideScreenFocused />);
    await waitFor(() => expect(screen.getByTestId('group.deck.guide')).toBeOnTheScreen());
  });

  test('route blur 뒤 완료된 비동기 안내 판정은 이전 episode queue를 다시 세우지 않는다', async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.guideGroupDeck);
    resetGroupDeckGuideSessionForTests();
    let finishGuideRead!: (value: string | null) => void;
    const pendingGuideRead = new Promise<string | null>((resolve) => {
      finishGuideRead = resolve;
    });
    jest
      .mocked(AsyncStorage.getItem)
      .mockImplementation((key) =>
        key === STORAGE_KEYS.guideGroupDeck ? pendingGuideRead : readStoredItem(key),
      );
    const props = {
      groups: [group()],
      userId: 'guide-async-blur',
      onSelect,
      onFocus,
      onSettings,
      groupEntry: 'tab' as const,
      onCreate,
      onFind,
      onRefresh,
    };
    const view = await render(<GroupListScreen {...props} viewEpisodeId={1} guideScreenFocused />);

    await view.rerender(
      <GroupListScreen {...props} viewEpisodeId={1} guideScreenFocused={false} />,
    );
    await act(async () => finishGuideRead(null));
    expect(logGroupCardDeckViewed).not.toHaveBeenCalled();

    await view.rerender(<GroupListScreen {...props} viewEpisodeId={1} guideScreenFocused />);
    expect(screen.queryByTestId('group.deck.guide')).toBeNull();

    await view.rerender(<GroupListScreen {...props} viewEpisodeId={2} guideScreenFocused />);
    await waitFor(() => expect(screen.getByTestId('group.deck.guide')).toBeOnTheScreen());
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStoredItem);
  });

  test('다른 overlay가 막고 있으면 미완료 안내를 pending으로 기록한다', async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.guideGroupDeck);
    resetGroupDeckGuideSessionForTests();

    await renderList([group()], undefined, 'user-1', true, true);

    expect(logGroupCardDeckViewed).toHaveBeenCalledWith({
      group_count_bucket: '1',
      group_entry: 'tab',
      guide_state: 'pending',
    });
    expect(screen.queryByTestId('group.deck.guide')).toBeNull();
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

  test('계정·그룹별로 저장한 아이콘을 카드 앞면에 반영한다', async () => {
    await writeGroupCardEmoji('user-1', GROUP_ID, '📚');
    await renderList([group()]);

    await waitFor(() =>
      expect(
        within(screen.getByTestId(`group.card.front.${GROUP_ID}`)).getByText('📚'),
      ).toBeOnTheScreen(),
    );
  });

  test('아이콘 hydration이 끝나기 전에는 기본 아이콘 덱을 먼저 노출하지 않는다', async () => {
    let finishEmojiRead!: (value: string | null) => void;
    const pendingEmojiRead = new Promise<string | null>((resolve) => {
      finishEmojiRead = resolve;
    });
    jest.mocked(AsyncStorage.getItem).mockImplementation((key) => {
      if (key === STORAGE_KEYS.groupCardEmoji) return pendingEmojiRead;
      return readStoredItem(key);
    });

    await renderList([group()], undefined, 'emoji-hydration', false);
    expect(screen.getByTestId('group.deck.loading')).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.card.front.${GROUP_ID}`)).toBeNull();

    await act(async () => {
      finishEmojiRead(JSON.stringify({ 'emoji-hydration': { [GROUP_ID]: '📚' } }));
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId(`group.card.front.${GROUP_ID}`)).getByText('📚'),
      ).toBeOnTheScreen(),
    );
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStoredItem);
  });
});

describe('콜백', () => {
  test('peek으로 보이는 이웃 카드를 탭하면 먼저 그 카드를 활성 페이지로 만든 뒤 뒤집는다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    await press(`group.card.${GROUP_ID_2}`);

    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('2 / 3');
    expect(screen.getByTestId(`group.card.back.${GROUP_ID_2}`)).toBeOnTheScreen();
  });

  test('비활성 이웃 카드는 터치 peek을 유지하되 접근성 트리에서는 숨긴다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    expect(screen.getByTestId(`group.list.card.${GROUP_ID}`).props).toEqual(
      expect.objectContaining({
        accessibilityElementsHidden: false,
        importantForAccessibility: 'auto',
      }),
    );
    expect(
      screen.getByTestId(`group.list.card.${GROUP_ID_2}`, { includeHiddenElements: true }).props,
    ).toEqual(
      expect.objectContaining({
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants',
      }),
    );
  });

  test('보조기술의 앞·뒷면 전환은 accessibility_action으로 기록한다', async () => {
    await renderList([group()]);

    await act(async () => {
      fireEvent(screen.getByTestId(`group.card.${GROUP_ID}`), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      });
    });
    expect(logGroupCardFlipped).toHaveBeenLastCalledWith(
      expect.objectContaining({ to_face: 'back', trigger: 'accessibility_action' }),
    );

    await act(async () => {
      fireEvent(screen.getByTestId(`group.card.frontAction.${GROUP_ID}`), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      });
    });
    expect(logGroupCardFlipped).toHaveBeenLastCalledWith(
      expect.objectContaining({ to_face: 'front', trigger: 'accessibility_action' }),
    );
  });

  test('앞면 본문 탭은 같은 카드만 뒤집고 방 전체 보기에서만 onSelect한다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);

    await press(`group.card.${GROUP_ID_2}`);

    expect(screen.getByTestId(`group.card.back.${GROUP_ID_2}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`group.card.back.scroll.${GROUP_ID_2}`)).toBeOnTheScreen();
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
    expect(logGroupCardFlipped).toHaveBeenCalledWith(
      expect.objectContaining({ to_face: 'back', trigger: 'card_tap' }),
    );
    expect(logGroupCardActionClicked).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'room', role: 'member', back_source: 'user' }),
    );
  });

  test('복귀 목록 revision 전에 수락한 다른 카드 입력은 이전 카드 복원을 취소한다', async () => {
    const groups = [group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })];
    const view = await renderList(groups);
    await press(`group.card.${GROUP_ID}`);
    await press(`group.card.room.${GROUP_ID}`);

    // 느린 복귀 조회를 기다리는 동안 사용자가 다른 카드를 명시적으로 선택했다.
    await press(`group.card.${GROUP_ID_2}`);
    await view.rerender(
      <GroupListScreen
        groups={groups}
        groupsRevision={1}
        userId="user-1"
        onSelect={onSelect}
        onFocus={onFocus}
        onSettings={onSettings}
        viewEpisodeId={1}
        groupEntry="tab"
        onCreate={onCreate}
        onFind={onFind}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId(`group.card.back.${GROUP_ID_2}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID}`)).toBeNull();
  });

  test('복귀 목록 revision 전에 사용자가 앞면을 선택하면 이전 뒷면 복원을 취소한다', async () => {
    const view = await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await press(`group.card.room.${GROUP_ID}`);
    await press(`group.card.frontAction.${GROUP_ID}`);

    await view.rerender(
      <GroupListScreen
        groups={[group()]}
        groupsRevision={1}
        userId="user-1"
        onSelect={onSelect}
        onFocus={onFocus}
        onSettings={onSettings}
        viewEpisodeId={1}
        groupEntry="tab"
        onCreate={onCreate}
        onFind={onFind}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId(`group.card.${GROUP_ID}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID}`)).toBeNull();
  });

  test('복귀 복원은 새 episode 덱이 다시 마운트된 뒤 실행한다', async () => {
    const view = await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await press(`group.card.room.${GROUP_ID}`);

    let finishGuideRead!: (value: string | null) => void;
    const pendingGuideRead = new Promise<string | null>((resolve) => {
      finishGuideRead = resolve;
    });
    jest
      .mocked(AsyncStorage.getItem)
      .mockImplementation((key) =>
        key === STORAGE_KEYS.guideGroupDeck ? pendingGuideRead : readStoredItem(key),
      );

    await view.rerender(
      <GroupListScreen
        groups={[group()]}
        groupsRevision={1}
        userId="user-1"
        onSelect={onSelect}
        onFocus={onFocus}
        onSettings={onSettings}
        viewEpisodeId={2}
        groupEntry="tab"
        onCreate={onCreate}
        onFind={onFind}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByTestId('group.deck.loading')).toBeOnTheScreen();

    await act(async () => finishGuideRead('1'));
    await waitFor(() =>
      expect(screen.getByTestId(`group.card.back.${GROUP_ID}`)).toBeOnTheScreen(),
    );
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStoredItem);
  });

  test('CTA 연타는 첫 수락만 계측·전환한다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);

    const room = screen.getByTestId(`group.card.room.${GROUP_ID}`);
    await act(async () => {
      fireEvent.press(room);
      fireEvent.press(room);
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test('설정 CTA는 설정 action을 계측하고 설정 콜백으로 나간다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await press(`group.card.settings.${GROUP_ID}`);
    expect(onSettings).toHaveBeenCalledWith(GROUP_ID);
    expect(logGroupCardActionClicked).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settings', interaction_id: expect.any(String) }),
    );
  });

  test('첫 flip에서 실제 요약 dependency를 지연 로드한다', async () => {
    await renderList([group()], undefined, 'summary-user');
    expect(getGroupDetail).not.toHaveBeenCalled();

    await press(`group.card.${GROUP_ID}`);

    await waitFor(() => expect(getGroupDetail).toHaveBeenCalledWith(GROUP_ID, expect.any(String)));
    expect(getAnnouncements).toHaveBeenCalledWith(GROUP_ID);
    expect(getChallenges).toHaveBeenCalledWith(GROUP_ID, expect.any(String));
    expect(getMyRanking).toHaveBeenCalledWith(undefined, expect.any(String));
  });

  test('뒷면은 응답 순서 첫 공지와 그룹 활동의 compact 내용을 표시한다', async () => {
    jest
      .mocked(getAnnouncements)
      .mockResolvedValue([
        { id: 'notice-1', title: '오늘 모임', content: '저녁 8시에 시작해요', createdAt: '' },
      ]);
    jest.mocked(getChallenges).mockResolvedValue([
      {
        id: 'challenge-1',
        missionType: 'DURATION',
        missionCategory: 'FOCUS',
        durationMinutes: 60,
        windowStart: null,
        windowEnd: null,
        status: 'ACTIVE',
        createdAt: '',
        canParticipate: true,
        memberProgress: [],
      } as never,
    ]);
    await renderList([group()]);

    await press(`group.card.${GROUP_ID}`);

    expect(
      await screen.findByText('최신 공지 · 오늘 모임 — 저녁 8시에 시작해요'),
    ).toBeOnTheScreen();
    expect(screen.getByText('그룹 활동 · 하루 60분 집중')).toBeOnTheScreen();
  });

  test('공지와 그룹 활동이 없으면 개수 0 대신 명시적 빈 상태를 표시한다', async () => {
    await renderList([group()]);

    await press(`group.card.${GROUP_ID}`);

    expect(await screen.findByText('새 공지가 없어요.')).toBeOnTheScreen();
    expect(screen.getByText('진행 중인 그룹 활동이 없어요.')).toBeOnTheScreen();
  });

  test('뒷면 핵심 CTA는 새 상관키와 함께 이 그룹 집중으로 이동한다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await press(`group.card.focus.${GROUP_ID}`);

    expect(onFocus).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({
        interactionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        interactionAcceptedAt: expect.any(Number),
      }),
    );
    expect(logGroupCardActionClicked).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'focus', interaction_id: expect.any(String) }),
    );
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

  test('명시적 새로고침 버튼은 조회가 끝날 때까지만 잠기고 인디케이터를 세운다', async () => {
    // 조회가 끝나는 시점을 테스트가 쥔다 — 인디케이터가 '도는 동안'과 '끝난 뒤'를 나눠 본다.
    let finish!: () => void;
    onRefresh.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await renderList([group()]);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.list.refresh'));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('group.list.refresh').props.accessibilityState.disabled).toBe(true);

    // 끝나면 반드시 내린다 — 안 내리면 스피너가 영구히 남는다.
    await act(async () => {
      finish();
    });
    expect(screen.getByTestId('group.list.refresh').props.accessibilityState.disabled).toBe(false);
  });

  test('뒷면에서 명시적 새로고침하면 ready 요약 dependency도 다시 읽는다', async () => {
    await renderList([group()]);
    await press(`group.card.${GROUP_ID}`);
    await waitFor(() => expect(getGroupDetail).toHaveBeenCalledTimes(1));

    await press('group.list.refresh');

    await waitFor(() => expect(getGroupDetail).toHaveBeenCalledTimes(2));
    expect(getAnnouncements).toHaveBeenCalledTimes(2);
    expect(getChallenges).toHaveBeenCalledTimes(2);
  });
});

describe('제스처 중재와 재정렬', () => {
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
    expect(logGroupCardReordered).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'accessibility_action', from_index: 0, to_index: 1 }),
    );
  });

  test('hydration 전에는 grip 재정렬 입력을 받지 않는다', async () => {
    let resolveRead!: (value: string | null) => void;
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockImplementationOnce(() => new Promise((resolve) => (resolveRead = resolve)));
    await renderList([group(), group({ groupId: GROUP_ID_2 })], undefined, 'user-1', false);

    expect(screen.getByTestId('group.deck.loading')).toBeOnTheScreen();
    expect(screen.queryByTestId(`group.card.grip.${GROUP_ID}`)).toBeNull();

    await act(async () => resolveRead(null));
  });

  test('가장자리 자동 이동은 최초 index가 아니라 직전 target에서 누적된다', () => {
    const first = resolveDragTarget(0, 0, 0, 1, 3);
    const second = resolveDragTarget(0, 0, first.edgeOffset, 1, 3);

    expect(first.target).toBe(1);
    expect(second.target).toBe(2);
  });

  test('가장자리 밖 offset은 누적하지 않아 반대 방향 입력에 즉시 반응한다', () => {
    const atEnd = resolveDragTarget(3, 0, 0, 1, 3);
    const back = resolveDragTarget(3, 0, atEnd.edgeOffset, -1, 3);

    expect(atEnd).toEqual({ target: 3, edgeOffset: 0 });
    expect(back).toEqual({ target: 2, edgeOffset: -1 });
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

  test('grip을 가장자리에서 잡았다는 이유만으로 첫 move에 다음 slot으로 넘기지 않는다', async () => {
    await renderList([group(), group({ groupId: GROUP_ID_2, name: '저녁 스터디' })]);
    const grip = screen.getByTestId(`group.card.grip.${GROUP_ID}`);
    const responderEvent = {
      nativeEvent: { pageX: 999 },
      touchHistory: {
        touchBank: [],
        numberActiveTouches: 0,
        indexOfSingleActiveTouch: -1,
        mostRecentTimeStamp: 0,
      },
    };

    await act(async () => {
      grip.props.onResponderGrant?.(responderEvent);
      grip.props.onResponderMove?.(responderEvent, { dx: 10, moveX: 999 });
      grip.props.onResponderRelease?.(responderEvent, { dx: 10, moveX: 999 });
    });

    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID, GROUP_ID_2]);
    expect(logGroupCardReordered).not.toHaveBeenCalled();
  });

  test('grip 짧은 탭은 포인터 순서 변경 UI를 연다', async () => {
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
      grip.props.onResponderRelease?.(responderEvent, { dx: 0, moveX: 0 });
    });
    expect(screen.getByTestId(`group.card.orderMenu.${GROUP_ID}`)).toBeOnTheScreen();
    expect(screen.getByTestId('group.list.items').props.scrollEnabled).toBe(false);

    // 메뉴가 열린 동안 화면 밖 카드 flip과 indicator 이동은 수락하지 않는다.
    await press(`group.card.${GROUP_ID_2}`);
    await act(async () => {
      fireEvent(screen.getByTestId('group.deck.indicator'), 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(screen.queryByTestId(`group.card.back.${GROUP_ID_2}`)).toBeNull();
    expect(screen.getByTestId('group.deck.indicator.counter')).toHaveTextContent('1 / 3');

    await press('group.card.orderMenu.next');
    expect(logGroupCardReordered).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'pointer_control', from_index: 0, to_index: 1 }),
    );
    expect(screen.getByTestId(`group.card.orderMenu.${GROUP_ID}`)).toBeOnTheScreen();

    await press('group.card.orderMenu.previous');
    expect(logGroupCardReordered).toHaveBeenLastCalledWith(
      expect.objectContaining({ trigger: 'pointer_control', from_index: 1, to_index: 0 }),
    );
    expect(screen.getByTestId(`group.card.orderMenu.${GROUP_ID}`)).toBeOnTheScreen();

    await press('group.card.orderMenu.done');
    expect(screen.queryByTestId(`group.card.orderMenu.${GROUP_ID}`)).toBeNull();
  });

  test('FindMoreCard 영역에 놓은 drag는 원래 순서를 유지한다', async () => {
    const thirdId = `${GROUP_ID}-third`;
    await renderList([
      group(),
      group({ groupId: GROUP_ID_2, name: '저녁 스터디' }),
      group({ groupId: thirdId, name: '주말 모각공' }),
    ]);
    const grip = screen.getByTestId(`group.card.grip.${GROUP_ID}`);
    const responderEvent = {
      nativeEvent: { pageX: 100 },
      touchHistory: {
        touchBank: [],
        numberActiveTouches: 0,
        indexOfSingleActiveTouch: -1,
        mostRecentTimeStamp: 0,
      },
    };

    await act(async () => {
      grip.props.onResponderGrant?.(responderEvent);
      grip.props.onResponderMove?.(responderEvent, { dx: 2_000, moveX: 1_000 });
      grip.props.onResponderRelease?.(responderEvent, { dx: 2_000, moveX: 1_000 });
    });

    expect(
      screen
        .getByTestId('group.list.items')
        .props.data.map((item: GroupSummaryResponse) => item.groupId),
    ).toEqual([GROUP_ID, GROUP_ID_2, thirdId]);
    expect(logGroupCardReordered).not.toHaveBeenCalled();
  });

  test('순서 메뉴 대상 그룹이 소속 목록에서 사라지면 메뉴와 입력 잠금을 해제한다', async () => {
    const first = group();
    const second = group({ groupId: GROUP_ID_2, name: '저녁 스터디' });
    const view = await renderList([first, second]);
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
      grip.props.onResponderRelease?.(responderEvent, { dx: 0, moveX: 0 });
    });
    expect(screen.getByTestId(`group.card.orderMenu.${GROUP_ID}`)).toBeOnTheScreen();

    await view.rerender(
      <GroupListScreen
        groups={[second]}
        groupsRevision={1}
        userId="user-1"
        onSelect={onSelect}
        onFocus={onFocus}
        onSettings={onSettings}
        viewEpisodeId={1}
        groupEntry="tab"
        onCreate={onCreate}
        onFind={onFind}
        onRefresh={onRefresh}
      />,
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId(`group.card.orderMenu.${GROUP_ID}`, {
          includeHiddenElements: true,
        }),
      ).toBeNull(),
    );
    expect(screen.getByTestId('group.list.items').props.scrollEnabled).toBe(true);
  });
});
