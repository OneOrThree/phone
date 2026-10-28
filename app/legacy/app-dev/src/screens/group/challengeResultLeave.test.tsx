// 탈퇴자의 결과 소비 → 이탈(N53·C8) — **실물 그룹방 + 실물 루트 호스트**로 잠근다.
//
// 결과 모달의 소유자가 GroupRoomScreen에서 루트 ChallengeResultHost로 옮겨 가며(GROMO-1576),
// 방이 쥐고 있던 보장 하나가 둘로 쪼개졌다:
//   · 모달을 띄우는 것        → 호스트
//   · 결과를 다 본 뒤 방을 내리는 것 → 그룹방
// 둘을 잇는 것은 challengeResultGate 하나다. **그 이음매가 이 스위트의 검증 대상**이라, 어느
// 한쪽도 스텁으로 갈아끼우지 않는다 — 한쪽만 테스트하면 배선이 끊겨도 양쪽 다 초록이다.
//
// 원본: GroupRoomScreen.test.tsx의 '탈퇴자(MEMBER_ONLY)의 결과 소비 후 이탈' describe.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders } from 'axios';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import GroupRoomScreen from './GroupRoomScreen';
import ChallengeResultHost from './ChallengeResultHost';
import { OverlaySlotProvider } from '@/store/OverlaySlotContext';
import { navigationRef } from '@/navigation/navigationRef';
import {
  getAnnouncements,
  getChallenges,
  getGroupDetail,
  getMyChallengeResults,
} from '@/services/groupApi';
import { resolveGroupRoomNotFound } from './groupRoomNotFound';
import { notifyBetResultPush } from '@/services/betResultSignal';
import { getChallengeResultGate, resetChallengeResultGateForTests } from './challengeResultGate';
import type {
  GroupAnnouncementResponse,
  GroupDetailResponse,
  MyChallengeResultEntry,
} from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@/store/UserContext', () => ({ useUser: () => ({ userId: 'me' }) }));
jest.mock('@/store/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
// ⚠️ refresh는 **하나를 공유**한다. useCoins가 매 렌더 새 함수를 돌려주면 GroupRoomScreen의
//    load→reload→useFocusEffect 사슬이 렌더마다 재등록돼 무한 재조회 루프가 된다.
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

jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeResultShown: jest.fn(),
  logGroupChallengeResultClosed: jest.fn(),
  logGroupInviteShared: jest.fn(),
  logGroupRoomViewed: jest.fn(),
  logInviteLinkOpened: jest.fn(),
}));
jest.mock('@/services/inviteLinkApi', () => ({ issueInviteLink: jest.fn() }));
jest.mock('./groupRoomNotFound', () => ({ resolveGroupRoomNotFound: jest.fn() }));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  getAnnouncements: jest.fn(),
  getChallenges: jest.fn(),
  getMyChallengeResults: jest.fn(),
  // ⚠️ 선점·확인도 목한다 — 이 파일이 보는 것은 **탈퇴 유예의 순서**지 서버 왕복이 아니다.
  //    실물 claim이 서버를 부르면 실패해 모달이 안 뜨고, 유예 계약을 확인할 수 없다.
  claimMyChallengeResult: jest.fn(async () => ({ claimToken: 'tok' })),
  ackMyChallengeResult: jest.fn(async () => undefined),
}));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockGetAnnouncements = getAnnouncements as jest.MockedFunction<typeof getAnnouncements>;
const mockGetChallenges = getChallenges as jest.MockedFunction<typeof getChallenges>;
const mockGetMyChallengeResults = getMyChallengeResults as jest.MockedFunction<
  typeof getMyChallengeResults
>;
const mockResolveGroupRoomNotFound = resolveGroupRoomNotFound as jest.MockedFunction<
  typeof resolveGroupRoomNotFound
>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const onLeft = jest.fn();

function axiosErrorWith(status: number, code: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { code, message: '...' },
  });
}

function detail(): GroupDetailResponse {
  return {
    id: GROUP_ID,
    name: '아침 6시 집중방',
    description: null,
    missionCategory: 'FOCUS',
    missionType: 'DURATION',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    isPrivate: false,
    maxMembers: 5,
    status: 'WAITING',
    code: null,
    codeExpiresAt: null,
    noticeGrantedUserIds: [],
    members: [
      { userId: 'me', nickname: '나', role: 'OWNER', focusTimeMinutes: 30, totalFocusMinutes: 30 },
    ],
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

function Blank() {
  return <View />;
}
function Room() {
  return <GroupRoomScreen groupId={GROUP_ID} onLeft={onLeft} />;
}

async function renderRoom() {
  const view = await render(
    <OverlaySlotProvider>
      <ChallengeResultHost />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator initialRouteName="GroupRoom" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="그룹" component={Blank} />
          <Stack.Screen name="GroupRoom" component={Room} />
        </Stack.Navigator>
      </NavigationContainer>
    </OverlaySlotProvider>,
  );
  await act(async () => {});
  await act(async () => {});
  return view;
}

async function closeModal() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.challengeResult.close'));
  });
  await act(async () => {});
}

function memberOnly() {
  mockGetGroupDetail.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
  mockGetAnnouncements.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
  mockGetChallenges.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetChallengeResultGateForTests();
  mockGetChallenges.mockResolvedValue([]);
  mockGetAnnouncements.mockResolvedValue([] as GroupAnnouncementResponse[]);
  mockGetMyChallengeResults.mockResolvedValue([]);
  mockResolveGroupRoomNotFound.mockResolvedValue({ kind: 'retry' });
});

test('GroupRoom이 push된 상태에서도 결과 모달이 방 위에 뜬다', async () => {
  // 예전 소유자(GroupRoomScreen)는 루트 스택 sibling 위로 뜰 수 없었다 — 이 배치의 존재 이유다.
  mockGetGroupDetail.mockResolvedValue(detail());
  mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);

  await renderRoom();

  // 방은 정상적으로 열려 있고(멤버) 그 위에 결과 모달이 뜬다.
  // ⚠️ 그룹 이름은 방 헤더와 모달 양쪽에 있다 — 방이 떠 있음은 방 전용 노드로 확인한다.
  expect(screen.getByTestId('group.room.scroll')).toBeOnTheScreen();
  expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
});

describe('탈퇴자(MEMBER_ONLY)의 결과 소비 후 이탈', () => {
  test('결과가 있으면 onLeft를 미루고 모달부터 보여준다 — 마지막 장을 닫을 때 onLeft', async () => {
    memberOnly();
    mockGetMyChallengeResults.mockResolvedValue([
      resultEntry(),
      resultEntry({ sessionId: 's2', sessionDate: '2026-07-30' }),
    ]);

    await renderRoom();

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(onLeft).not.toHaveBeenCalled();

    // 첫 장을 닫아도 아직 — 큐가 남아 있다.
    await closeModal();
    expect(screen.getByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(onLeft).not.toHaveBeenCalled();

    // 마지막 장을 닫는 순간 방이 내려간다.
    await closeModal();
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    await waitFor(() => expect(onLeft).toHaveBeenCalledTimes(1));
  });

  test('보여줄 결과가 없으면 종전대로 즉시 onLeft', async () => {
    memberOnly();
    mockGetMyChallengeResults.mockResolvedValue([]);

    await renderRoom();

    await waitFor(() => expect(onLeft).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
  });

  // ⚠️ 소유자가 루트로 옮겨 가며 **방과 호스트의 재조회 계기가 갈렸다.** 결과 조회가 실패해
  //    gate가 'unknown'으로 굳으면 방은 이탈을 유예한 채 오류 화면을 세우는데, 그 화면의
  //    「다시 시도」가 호스트를 안 깨우면 사용자가 버튼을 아무리 눌러도 아무 일도 없다 —
  //    제한적 재조회(30초×5회)까지 끝난 뒤라면 그 사용자는 결과를 못 본 채 방에 갇힌다.
  test('「다시 시도」를 누르면 결과 조회도 다시 나간다', async () => {
    memberOnly();
    mockGetMyChallengeResults.mockRejectedValue(new Error('network'));

    await renderRoom();
    expect(onLeft).not.toHaveBeenCalled();
    const callsBeforeRetry = mockGetMyChallengeResults.mock.calls.length;

    // 네트워크가 회복됐고 사용자가 버튼을 누른다.
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await act(async () => {
      fireEvent.press(screen.getByText('다시 시도'));
    });
    await act(async () => {});

    expect(mockGetMyChallengeResults.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    // 그리고 그 결과가 실제로 화면에 닿는다 — 갇힘이 풀린다.
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
  });

  test('결과를 "모르는" 동안에는 나가지 않는다 — 0건이 확정된 뒤에야 나간다', async () => {
    // '모르겠다'와 '없다'를 같은 값으로 말하면, 다른 소속 그룹이 없는 탈퇴자는 정산 결과를
    // 영영 못 본다(challengeResult.ts의 null 계약 D1이 지키려는 바로 그 경로).
    memberOnly();
    mockGetMyChallengeResults.mockRejectedValue(new Error('network'));

    await renderRoom();
    expect(onLeft).not.toHaveBeenCalled();

    // 회복된 조회가 '정말 없다'를 확정하면 그때 나간다 — 방이 다시 조회하지 않아도 된다.
    // 재조회 계기는 정본이 못 박은 셋 중 하나(BET_RESULT 수신)를 쓴다.
    mockGetMyChallengeResults.mockResolvedValue([]);
    await act(async () => {
      notifyBetResultPush();
    });
    await act(async () => {});

    await waitFor(() => expect(onLeft).toHaveBeenCalledTimes(1));
  });

  // ⚠️ 소유자가 루트로 옮겨 가며 gate는 **모듈 전역**이 됐다 — 방이 다른 화면 아래에 깔려
  //    있어도 구독은 그대로 울린다. 그때 이탈하면 goBack()이 **지금 보고 있는 화면**을 팝한다.
  //    그렇다고 무시하면 이탈 계기를 잃어 탈퇴자가 방에 갇힌다 — 미뤘다가 재포커스 때 잇는다.
  test('방이 다른 화면 아래에 있으면 이탈을 미루고, 다시 포커스될 때 나간다', async () => {
    memberOnly();
    mockGetMyChallengeResults.mockRejectedValue(new Error('network'));

    await renderRoom();
    expect(onLeft).not.toHaveBeenCalled();

    // 방 위로 다른 화면을 push — 방은 마운트된 채 포커스만 잃는다.
    await act(async () => {
      (navigationRef.navigate as unknown as (name: string) => void)('그룹');
    });
    await act(async () => {});

    // 그 사이 결과가 "정말 없다"로 확정된다.
    mockGetMyChallengeResults.mockResolvedValue([]);
    await act(async () => {
      notifyBetResultPush();
    });
    await act(async () => {});

    expect(getChallengeResultGate()).toBe('none');
    // 지금 보고 있는 화면을 팝하면 안 된다.
    expect(onLeft).not.toHaveBeenCalled();

    // 방으로 돌아오는 순간 미뤄 둔 이탈을 잇는다.
    await act(async () => {
      navigationRef.goBack();
    });
    await act(async () => {});

    await waitFor(() => expect(onLeft).toHaveBeenCalledTimes(1));
  });
});

// P1 ① — 새 판정이 도는 동안 이전 판정('없다')이 남아 있으면, 탈퇴자가 결과 딥링크로 방에
// 들어올 때 MEMBER_ONLY가 먼저 도착해 **즉시** 방이 내려간다. 뒤늦게 결과를 찾아도 이미
// 그룹 흐름 밖이라 모달이 갈 곳이 없다 — D1이 지키려던 바로 그 경로다.
test('이전 판정이 "없다"였어도 새 조회가 도는 동안에는 방을 내리지 않는다', async () => {
  // 1) 그룹 흐름 밖에서 시작해 "결과 없음"이 확정된 상태를 만든다.
  mockGetGroupDetail.mockResolvedValue(detail());
  mockGetMyChallengeResults.mockResolvedValue([]);
  const view = await render(
    <OverlaySlotProvider>
      <ChallengeResultHost />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator initialRouteName="그룹" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="그룹" component={Blank} />
          <Stack.Screen name="GroupRoom" component={Room} />
        </Stack.Navigator>
      </NavigationContainer>
    </OverlaySlotProvider>,
  );
  await act(async () => {});
  expect(getChallengeResultGate()).toBe('none');

  // 2) 결과 조회는 느리고, 방의 MEMBER_ONLY는 즉시 도착한다(딥링크 착지의 실제 순서).
  let releaseResults: (entries: MyChallengeResultEntry[]) => void = () => undefined;
  mockGetMyChallengeResults.mockReturnValue(
    new Promise<MyChallengeResultEntry[]>((resolve) => {
      releaseResults = resolve;
    }),
  );
  memberOnly();

  await act(async () => {
    (navigationRef.navigate as unknown as (name: string, params?: object) => void)('GroupRoom', {
      groupId: GROUP_ID,
      challengeId: 'c1',
    });
  });
  await act(async () => {});

  // 조회가 도는 동안은 '모른다'다 — 방이 나가면 안 된다.
  expect(getChallengeResultGate()).toBe('unknown');
  expect(onLeft).not.toHaveBeenCalled();

  // 3) 뒤늦게 결과가 도착한다 — 방은 아직 살아 있고 모달이 그 위에 뜬다.
  await act(async () => {
    releaseResults([resultEntry()]);
  });
  await act(async () => {});

  expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
  expect(onLeft).not.toHaveBeenCalled();
  view.unmount();
});
