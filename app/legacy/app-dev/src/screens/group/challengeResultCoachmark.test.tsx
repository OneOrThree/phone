// 그룹 덱 코치마크 ↔ 챌린지 결과 모달 조정(GROMO-1576) — **실물 화면 두 개**로 잠근다.
//
// ⚠️ 여기서 스텁을 쓰면 안 되는 이유: 조정자만 단위 테스트해 두면 "GroupListScreen이 등록을
//    빠뜨렸다" · "호스트가 slot을 안 본다" 같은 **배선 누락이 초록으로 통과**한다. 그래서 이
//    스위트는 진짜 GroupListScreen과 진짜 ChallengeResultHost를 같은 조정자 아래에 세우고,
//    라우트도 진짜 NavigationContainer로 만든다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import GroupListScreen from './GroupListScreen';
import ChallengeResultHost from './ChallengeResultHost';
import { OverlaySlotProvider } from '@/store/OverlaySlotContext';
import { navigationRef } from '@/navigation/navigationRef';
import { getMyChallengeResults } from '@/services/groupApi';
import { notifyBetResultPush } from '@/services/betResultSignal';
import { resetGroupDeckGuideSessionForTests } from './groupDeckGuide';
import { resetChallengeResultGateForTests } from './challengeResultGate';
import { STORAGE_KEYS } from '@/types/storage';
import type { GroupSummaryResponse, MyChallengeResultEntry } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@/store/UserContext', () => ({ useUser: () => ({ userId: 'me' }) }));
// refresh는 하나를 공유한다 — 매 렌더 새 함수를 주면 소비자의 이펙트 사슬이 계속 재등록된다.
const mockRefreshCoins = jest.fn(async () => true);
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({
    coins: 5000,
    coinsLoaded: true,
    coinsVersion: 1,
    latestCoinsVersion: () => 1,
    refresh: mockRefreshCoins,
  }),
}));
jest.mock('@/utils/haptics', () => ({ hapticMedium: jest.fn() }));
jest.mock('./useGroupCardData', () => ({
  useGroupCardData: () => ({ snapshots: {}, ensureBack: jest.fn(), retry: jest.fn() }),
}));

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
  logGroupChallengeResultShown: jest.fn(),
  logGroupChallengeResultClosed: jest.fn(),
  logInviteLinkOpened: jest.fn(),
}));

// ⚠️ 선점·확인도 함께 목한다 — 이 테스트가 보는 것은 **자리 다툼**이지 서버 왕복이 아니다.
//    실물 claim이 서버를 부르면 실패해 모달이 아예 안 뜨고, 그러면 이 파일의 단정이 전부
//    "코치마크가 이겼다"로 조용히 통과하는 게 아니라 아예 못 찾는 실패가 된다.
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getMyChallengeResults: jest.fn(),
  claimMyChallengeResult: jest.fn(async () => ({ claimToken: 'tok' })),
  ackMyChallengeResult: jest.fn(async () => undefined),
}));
const mockGetMyChallengeResults = getMyChallengeResults as jest.MockedFunction<
  typeof getMyChallengeResults
>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

function group(): GroupSummaryResponse {
  return {
    groupId: GROUP_ID,
    name: '아침 6시 집중방',
    code: null,
    currentMembers: 2,
    maxMembers: 5,
    role: 'MEMBER',
    status: 'WAITING',
  };
}

function resultEntry(over: Partial<MyChallengeResultEntry> = {}): MyChallengeResultEntry {
  return {
    sessionId: 's1',
    groupId: GROUP_ID,
    groupName: '아침 6시 집중방',
    challengeId: 'c1',
    challengeDeleted: false,
    challengeEnded: false,
    sessionDate: '2026-07-31',
    stake: 30,
    pot: 60,
    status: 'SETTLED',
    voidReason: null,
    goalMinutes: 60,
    myAchieved: true,
    myPayout: 60,
    results: [
      { userId: 'me', nickname: '나', achieved: true, payout: 60, progressMinutes: 70 },
      { userId: 'u2', nickname: '수빈', achieved: false, payout: 0, progressMinutes: 20 },
    ],
    ...over,
  };
}

const Stack = createNativeStackNavigator();

function GroupTab() {
  return (
    <View>
      <GroupListScreen
        groups={[group()]}
        userId="me"
        onSelect={jest.fn()}
        onCreate={jest.fn()}
        onFind={jest.fn()}
        onRefresh={jest.fn(async () => undefined)}
        guideEpisode={1}
        guideDataReady
      />
    </View>
  );
}

async function renderGroupTab() {
  const view = await render(
    <OverlaySlotProvider>
      <ChallengeResultHost />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator initialRouteName="그룹" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="그룹" component={GroupTab} />
        </Stack.Navigator>
      </NavigationContainer>
    </OverlaySlotProvider>,
  );
  await act(async () => {});
  return view;
}

// 코치마크는 덱과 카드의 레이아웃이 확정돼야 자격을 얻는다 — 테스트가 그 시점을 직접 만든다.
async function layoutDeck() {
  await act(async () => {
    fireEvent(screen.getByTestId('group.deck.guideAnchor'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 520 } },
    });
    fireEvent(screen.getByTestId(`group.list.card.${GROUP_ID}`), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 520 } },
    });
  });
  await act(async () => {});
}

async function pressGuide() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.list.guide', { includeHiddenElements: true }));
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetGroupDeckGuideSessionForTests();
  resetChallengeResultGateForTests();
  await AsyncStorage.removeItem(STORAGE_KEYS.guideGroupDeck);
  mockGetMyChallengeResults.mockResolvedValue([]);
});

test('코치마크가 slot을 쥐고 있으면 결과 모달은 **마운트되지 않고**, 안내가 끝나면 그때 뜬다', async () => {
  await renderGroupTab();
  await layoutDeck();
  expect(await screen.findByTestId('group.list.guide')).toBeOnTheScreen();

  // 안내를 보는 사이 정산이 끝나 결과가 도착했다.
  mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
  await act(async () => {
    notifyBetResultPush();
  });
  await act(async () => {});

  // 가려진 것이 아니라 **트리에 없다** — 숨은 요소까지 뒤져도 없어야 한다.
  expect(screen.queryByTestId('group.challengeResult', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId('group.list.guide')).toBeOnTheScreen();

  // 안내 4단계를 끝내면 slot이 풀리고, 대기하던 결과가 그때 뜬다.
  for (let step = 0; step < 4; step += 1) await pressGuide();
  expect(screen.queryByTestId('group.list.guide')).toBeNull();
  expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
});

test('아직 뜨지 않은 코치마크보다 결과 모달이 먼저 slot을 받는다(우선순위)', async () => {
  // 결과가 먼저 도착해 slot을 쥔 상태에서 코치마크가 자격을 갖춘다.
  mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
  await renderGroupTab();
  expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();

  await layoutDeck();
  // 결과가 떠 있는 동안 안내는 서지 않는다 — 큐에 남아 기다린다.
  expect(screen.queryByTestId('group.list.guide', { includeHiddenElements: true })).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId('group.challengeResult.close'));
  });
  await act(async () => {});

  // 결과가 끝나면 기다리던 안내가 그때 뜬다(안내는 재노출이 가능하다 — 그래서 뒤로 밀려도 안전하다).
  await waitFor(() => expect(screen.getByTestId('group.list.guide')).toBeOnTheScreen());
});
