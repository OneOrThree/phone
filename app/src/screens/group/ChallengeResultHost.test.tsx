// ChallengeResultHost — 챌린지 결과 모달의 **루트 소유자** 테스트(GROMO-1576).
//
// 여기서 잠그는 것:
//  1) 트리거가 화면 좌표가 아니라 **그룹 흐름 라우트**다. 그룹 탭 랜딩(카드 덱)에서도,
//     GroupRoom이 push된 상태에서도 뜨고, 그룹 흐름 밖(홈 탭)에서는 뜨지 않는다.
//     ⚠️ 이 스위트는 **진짜 NavigationContainer**를 렌더한다. navigationRef를 스텁으로
//        갈아끼우면 "라우트를 실제로 읽고 있는가"라는 검증 대상 자체가 사라진다.
//  2) 큐·1회 가드·지목(focusChallengeId)·빈 응답 정본 — GroupRoomScreen에서 통째로 옮겨 온
//     계약이다(원본: GroupRoomScreen.test.tsx의 '챌린지 결과 모달(GROMO-1279)' describe).
//  3) 다른 전면 오버레이가 slot을 쥐고 있으면 **마운트 자체를 하지 않는다.**
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, View, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChallengeResultHost from './ChallengeResultHost';
import {
  OverlaySlotProvider,
  useOverlayBlocker,
  OVERLAY_PRIORITY,
  useOverlaySlot,
} from '@/store/OverlaySlotContext';
import { navigationRef } from '@/navigation/navigationRef';
import { getMyChallengeResults } from '@/services/groupApi';
// 정산 결과 푸시 신호는 **실물 모듈**을 그대로 쓴다 — 호스트가 실제로 구독했는지(배선)를
// 보는 것이 목적이라 스텁으로 갈아끼우면 검증 대상이 사라진다.
import { notifyBetResultPush } from '@/services/betResultSignal';
import { getChallengeResultGate, resetChallengeResultGateForTests } from './challengeResultGate';
import type { MyChallengeResultEntry } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ userId: 'me' }),
}));

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
  logInviteLinkOpened: jest.fn(),
}));
const { logGroupChallengeResultShown, logGroupChallengeResultClosed } = jest.requireMock(
  '@/services/analyticsEvents',
);

// 인증 세대 — 계정(토큰) 교체를 테스트가 직접 굴린다. ack 복구가 이 값을 캡처해 재검증한다.
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api'),
  getAuthSessionGeneration: jest.fn(() => 1),
}));
const mockAuthGeneration = jest.requireMock('@/services/api').getAuthSessionGeneration as jest.Mock;

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getMyChallengeResults: jest.fn(),
  getMyGroups: jest.fn(),
}));
const mockGetMyChallengeResults = getMyChallengeResults as jest.MockedFunction<
  typeof getMyChallengeResults
>;

// 선점·확인 경계(W3 GROMO-1577) — **호출 계약**을 검증하려고 목으로 둔다. 실구현은 통합 시
// challengeResultClaim.ts가 './challengeResult'를 재수출하며 붙는다(그 파일 헤더 주석).
jest.mock('./challengeResultClaim', () => ({
  claimChallengeResult: jest.fn(),
  ackChallengeResult: jest.fn(),
  pendingAckChallengeResults: jest.fn(),
  reconcileChallengeResultAck: jest.fn(),
}));
const {
  claimChallengeResult: mockClaim,
  ackChallengeResult: mockAck,
  pendingAckChallengeResults: mockPendingAck,
  reconcileChallengeResultAck: mockReconcileAck,
} = jest.requireMock('./challengeResultClaim') as {
  claimChallengeResult: jest.Mock;
  ackChallengeResult: jest.Mock;
  pendingAckChallengeResults: jest.Mock;
  reconcileChallengeResultAck: jest.Mock;
};

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

// 참가자 스코프 결과 1건(/me/challenge-results) — 결과 모달 큐의 원천.
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

// 사용자가 방금 연 시트를 흉내 내는 blocker — **실제 조정자 API**(useOverlayBlocker)를 그대로
// 쓴다. 프로덕션에서 이 자리를 채우는 것이 GroupScreen·GroupRoomScreen의 시트이고, 그 배선은
// challengeResultOverlay.test.tsx가 실물 화면으로 잠근다.
function TestSheet({ open }: { open: boolean }) {
  useOverlayBlocker('test:sheet', open);
  return null;
}

// 코치마크와 같은 우선순위·같은 규칙(승인받았을 때만 마운트)으로 도는 경쟁자.
function TestGuide({ active, onStatus }: { active: boolean; onStatus: (s: string) => void }) {
  const status = useOverlaySlot('test:guide', {
    priority: OVERLAY_PRIORITY.groupDeckGuide,
    active,
  });
  onStatus(status);
  return null;
}

type TestRoute = '홈' | '그룹' | 'GroupRoom' | 'GroupSettings';

interface HostHarnessProps {
  initialRoute?: TestRoute;
  sheetOpen?: boolean;
}

// 프로덕션과 **같은 배치**: 호스트는 NavigationContainer의 형제이고, 조정자가 둘을 감싼다.
function Harness({ initialRoute = '그룹', sheetOpen = false }: HostHarnessProps) {
  return (
    <OverlaySlotProvider>
      <TestSheet open={sheetOpen} />
      <ChallengeResultHost />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="홈" component={Blank} />
          <Stack.Screen name="그룹" component={Blank} />
          <Stack.Screen name="GroupRoom" component={Blank} />
          <Stack.Screen name="GroupSettings" component={Blank} />
        </Stack.Navigator>
      </NavigationContainer>
    </OverlaySlotProvider>
  );
}

async function renderHost(props: HostHarnessProps = {}) {
  const view = await render(<Harness {...props} />);
  await act(async () => {});
  return view;
}

async function navigate(route: TestRoute, params?: object) {
  await act(async () => {
    // 테스트 전용 스택이라 앱의 라우트 타입(V2RootStackParamList)과 맞지 않는다.
    (navigationRef.navigate as unknown as (name: string, params?: object) => void)(route, params);
  });
  await act(async () => {});
}

// 서버가 새 정산을 알리는 실제 계기 — 호스트가 이 신호를 구독하고 있어야 재조회가 돈다.
async function betResultPush() {
  await act(async () => {
    notifyBetResultPush();
  });
  await act(async () => {});
}

async function closeModal() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.challengeResult.close'));
  });
}

// AppState 전환을 테스트가 직접 굴린다 — 호스트의 활동 세대 가드가 그 전환을 본다.
let appStateHandler: ((state: AppStateStatus) => void) | null = null;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  resetChallengeResultGateForTests();
  mockGetMyChallengeResults.mockResolvedValue([]);
  // 기본은 "선점·재검증 성공 · 확인 성공 · 복구 대상 없음" — 이 축이 관심사가 아닌 테스트가
  // 그대로 돌게 한다. 재검증은 서버 계약대로 **같은 토큰**을 돌려준다(비회전).
  mockClaim.mockImplementation(async (sessionId: string, currentToken?: string) => ({
    ok: true as const,
    claimToken: currentToken ?? `tok-${sessionId}`,
  }));
  mockAck.mockResolvedValue(true);
  mockPendingAck.mockResolvedValue([]);
  mockReconcileAck.mockResolvedValue(true);
  mockAuthGeneration.mockReturnValue(1);
});

describe('그룹 흐름 라우트에서만 연다', () => {
  test('그룹 탭 랜딩(카드 덱)에서 뜬다 — 소속 그룹 수·그룹방 진입과 무관하다(N56)', async () => {
    // 소속 0개여도 큐는 참가자 스코프라 성립한다. 호스트는 그룹 목록을 조회조차 하지 않는다.
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost({ initialRoute: '그룹' });

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(screen.getByText('7월 31일 결과')).toBeOnTheScreen();
    // 소속 수에 매달리지 않는다는 것을 배선으로 확인한다 — 그룹 목록을 아예 부르지 않는다.
    expect(jest.requireMock('@/services/groupApi').getMyGroups).not.toHaveBeenCalled();
  });

  test('GroupRoom이 push된 상태에서도 뜬다 — 이 배치의 존재 이유', async () => {
    // 예전 소유자(GroupRoomScreen)는 루트 스택 sibling 위로 뜰 수 없었다.
    // 결과 딥링크 착지 그대로 재현한다: 그룹 흐름 **밖**에서 곧장 그룹방으로 들어간다.
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost({ initialRoute: '홈' });
    await navigate('GroupRoom', { groupId: GROUP_ID, challengeId: undefined });

    expect(navigationRef.getCurrentRoute()?.name).toBe('GroupRoom');
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
  });

  // 재조회 계기는 정본이 셋으로 못 박았다(policy §D3 · HLD): 셸 활성화 · 포그라운드 복귀 ·
  // BET_RESULT 수신. 그룹 흐름 **내부** 이동은 계기가 아니다 — 화면을 오갈 때마다 조회가
  // 추가로 나가면 그룹 탭을 왔다 갔다 하는 것만으로 서버 부하가 배로 뛴다.
  test('그룹 흐름 **내부** 화면 전환으로는 재조회하지 않는다', async () => {
    await renderHost({ initialRoute: '그룹' });
    expect(mockGetMyChallengeResults).toHaveBeenCalledTimes(1);

    await navigate('GroupRoom', { groupId: GROUP_ID, challengeId: undefined });
    await navigate('그룹');

    expect(mockGetMyChallengeResults).toHaveBeenCalledTimes(1);

    // 그룹 흐름을 벗어났다 다시 들어오는 것(셸 활성화)은 계기가 맞다.
    await navigate('홈');
    await navigate('그룹');
    expect(mockGetMyChallengeResults).toHaveBeenCalledTimes(2);
  });

  test('그룹 흐름 밖(홈 탭)에서는 조회도 노출도 하지 않는다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost({ initialRoute: '홈' });

    expect(mockGetMyChallengeResults).not.toHaveBeenCalled();
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();

    // 그룹 흐름으로 들어가는 순간 조회하고 띄운다.
    await navigate('그룹');
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
  });

  test('그룹 흐름을 벗어나면 떠 있던 모달을 내린다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost({ initialRoute: '그룹' });
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();

    await navigate('홈');
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
  });
});

describe('다른 전면 오버레이와의 배타', () => {
  test('다른 오버레이가 slot을 쥐고 있으면 **마운트하지 않고**, 놓으면 그때 뜬다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    const view = await renderHost({ initialRoute: '그룹', sheetOpen: true });

    // "렌더는 되고 가려진다"가 아니라 트리에 없다 — 숨은 요소까지 뒤져도 없어야 한다.
    expect(
      screen.queryByTestId('group.challengeResult', { includeHiddenElements: true }),
    ).toBeNull();

    await act(async () => {
      view.rerender(<Harness initialRoute="그룹" sheetOpen={false} />);
    });
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
  });

  test('결과가 slot을 쥐고 있는 동안 코치마크 우선순위는 승인받지 못한다', async () => {
    // 우선순위 자체(동시 등록 시 결과가 이긴다)는 조정자 단위 테스트가 잠근다
    // (store/OverlaySlotContext.test.tsx). 여기서 보는 것은 **실물 호스트가 그 규칙 위에
    // 올라타 있는가**다 — 결과가 떠 있는 동안 코치마크 우선순위 요청은 pending이어야 한다.
    const statuses: string[] = [];
    const tree = (guideActive: boolean) => (
      <OverlaySlotProvider>
        <ChallengeResultHost />
        <TestGuide active={guideActive} onStatus={(s) => statuses.push(s)} />
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator initialRouteName="그룹" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="그룹" component={Blank} />
          </Stack.Navigator>
        </NavigationContainer>
      </OverlaySlotProvider>
    );
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    const view = await render(tree(false));
    await act(async () => {});

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();

    // 결과가 떠 있는 사이 코치마크가 자격을 갖췄다 — 승인은 결과가 끝난 뒤다.
    await act(async () => {
      view.rerender(tree(true));
    });
    expect(statuses[statuses.length - 1]).toBe('pending');

    await closeModal();
    await waitFor(() => expect(statuses[statuses.length - 1]).toBe('granted'));
  });
});

// ── D8 순서: slot → 선점(claim) → **활성 claim 재검증** → 노출 → ack ─────────────
// ⚠️ 이 스위트가 없으면 W2·W3가 다 머지돼도 **호출부가 비어 기능이 안 켜진다** — 그리고 그
//    상태에서도 다른 테스트는 전부 초록이다(조정자 사전 게이트가 잡은 실패 모드).
// ⚠️ 호출 **여부**만 보지 않는다. 순서가 계약이다.
describe('선점·재검증·확인 배선(claim → verify → 노출 → ack)', () => {
  // 호출 순서를 한 배열에 모아 **그 배열 전체**를 단언한다 — 단계 하나가 빠지면 바로 드러난다.
  // 각 줄에 **실제로 오간 토큰**을 함께 적어, 단언이 값이 아니라 관계를 보게 한다.
  // 재검증은 서버 계약대로 **같은 토큰**을 돌려준다(비회전) — 대역도 그래야 통합이 재수출
  // 한 줄로 끝난다.
  function recordOrder(order: string[]) {
    let issued = 0;
    mockClaim.mockImplementation(async (sessionId: string, currentToken?: string) => {
      if (currentToken !== undefined) {
        order.push(`verify:${sessionId}:${currentToken}:${currentToken}`);
        return { ok: true as const, claimToken: currentToken };
      }
      issued += 1;
      const claimToken = `tok-${issued}`;
      order.push(`claim:${sessionId}:${claimToken}`);
      return { ok: true as const, claimToken };
    });
    mockAck.mockImplementation(async (sessionId: string, token: string) => {
      order.push(`ack:${sessionId}:${token}`);
      return true;
    });
    (logGroupChallengeResultShown as jest.Mock).mockImplementation(() => {
      order.push('shown');
    });
  }

  test('선점 → 그 토큰으로 재검증 → 노출 → ack 순서로 부른다', async () => {
    const order: string[] = [];
    recordOrder(order);

    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost();
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();

    // ⚠️ 토큰 값을 **문자열로 박지 않는다.** 계약은 "ack가 재검증 결과의 토큰을 쓴다"이지
    //    그 값이 무엇이냐가 아니다. 서버는 지금 같은 토큰을 돌려주지만(비회전), 그 정책이
    //    바뀌어도 이 단언은 계속 옳아야 한다 — 값을 박으면 대역의 동작을 박제하게 된다.
    await waitFor(() => expect(order).toHaveLength(4));
    const acquired = order[0].split(':')[2]; // claim:s1:<token>
    const verified = order[1].split(':')[3]; // verify:s1:<sent>:<token>
    expect(order).toEqual([
      `claim:s1:${acquired}`,
      // 재검증은 **첫 응답의 토큰을 실어** 부른다. 이 단계가 빠지면 배열 길이부터 어긋난다.
      `verify:s1:${acquired}:${verified}`,
      'shown',
      // ack는 **재검증이 돌려준 토큰**을 쓴다.
      `ack:s1:${verified}`,
    ]);
  });

  // 사용자가 모달을 본 뒤 **닫기 전에 강제 종료·크래시**하면 서버엔 미확인으로 남는데, 로컬
  // 마커는 이미 노출 시점에 찍혀(D2) 다음 실행에서 후보가 걸러진다 — ack가 다시 시작될 계기가
  // 없다. 그래서 ack는 닫기가 아니라 **노출이 커밋된 순간**에 시작한다.
  test('닫기 전에 이미 ack를 보낸다 — 닫히지 않아도 서버에 확인이 남는다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost();
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();

    // 아직 아무것도 닫지 않았다. 토큰은 **재검증이 돌려준 값**이면 되고, 그 값이 무엇인지는
    // 계약이 아니다(위 순서 테스트와 같은 이유).
    await waitFor(() => expect(mockAck).toHaveBeenCalledTimes(1));
    const verified = mockClaim.mock.results.at(-1)?.value;
    expect(mockAck).toHaveBeenCalledWith('s1', (await verified).claimToken);
  });

  test('재검증이 실패하면(다른 기기가 lease를 가져갔다) 모달을 띄우지 않는다', async () => {
    // 첫 선점은 성공했는데 렌더 직전 재검증에서 보유자가 아님이 드러난 경우 —
    // 낡은 성공 응답을 믿고 노출하면 두 기기가 같은 결과를 동시에 본다.
    mockClaim.mockImplementation(async (_sessionId: string, currentToken?: string) =>
      currentToken === undefined
        ? { ok: true as const, claimToken: 'tok-a' }
        : { ok: false as const, retryAfterMs: 60_000 },
    );
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost();

    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('s1', 'tok-a'));
    expect(
      screen.queryByTestId('group.challengeResult', { includeHiddenElements: true }),
    ).toBeNull();
    expect(mockAck).not.toHaveBeenCalled();
  });

  test('선점에 실패하면(다른 기기가 열고 있다) 모달을 띄우지 않는다', async () => {
    mockClaim.mockResolvedValue({ ok: false, retryAfterMs: 60_000 });
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost();

    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('s1'));
    expect(
      screen.queryByTestId('group.challengeResult', { includeHiddenElements: true }),
    ).toBeNull();
    // 큐에서 빼지도 않는다 — 그 기기가 못 보고 닫을 수 있다.
    expect(getChallengeResultGate()).toBe('pending');
    expect(mockAck).not.toHaveBeenCalled();
  });

  // 대기하는 사이 다른 기기가 그 결과를 ack 했을 수 있다. 메모리에 있는 stale head를 그대로
  // 다시 선점하면 RESULT_ALREADY_ACKED만 돌아오며 **뒤의 결과까지 영영 막힌다**
  // (제한적 재조회 5회가 이미 끝났다면 이 자리가 유일한 갱신 계기다).
  test('선점 재시도 전에 서버 큐를 다시 판정한다', async () => {
    jest.useFakeTimers();
    try {
      mockClaim.mockResolvedValue({ ok: false, retryAfterMs: 1_000 });
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await renderHost();
      expect(mockGetMyChallengeResults).toHaveBeenCalledTimes(1);

      // 그 사이 다른 기기가 s1을 소비했고, 뒤에 있던 s2가 큐의 새 머리가 됐다.
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's2', sessionDate: '2026-07-30' }),
      ]);
      mockClaim.mockImplementation(async (_sessionId: string, currentToken?: string) => ({
        ok: true as const,
        claimToken: currentToken ?? 'tok-s2',
      }));

      await act(async () => {
        jest.advanceTimersByTime(1_200);
      });
      await act(async () => {});
      await act(async () => {});

      // 재시도가 같은 후보를 다시 claim 하는 것이 아니라 **먼저 조회**했다.
      expect(mockGetMyChallengeResults).toHaveBeenCalledTimes(2);
      // 1회차 = 실패한 s1 선점, 2회차 = 갱신된 머리 s2 선점(3회차는 그 토큰의 재검증).
      expect(mockClaim).toHaveBeenNthCalledWith(2, 's2');
    } finally {
      jest.useRealTimers();
    }
  });

  // ⚠️ 호스트의 수명 조건은 **그룹 흐름 focus**다. 선점 재시도 타이머가 흐름 밖에서 깨어나면
  //    거기서 load()가 나가 큐와 **모듈 전역** gate를 되살리고, 아래에 남은 탈퇴 유예 GroupRoom이
  //    그 'none'을 보고 goBack()으로 지금 보고 있는 화면을 팝한다.
  test('선점 재시도 대기 중 그룹 흐름을 벗어나면 재조회를 쏘지 않는다', async () => {
    jest.useFakeTimers();
    try {
      mockClaim.mockResolvedValue({ ok: false, retryAfterMs: 1_000 });
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await renderHost({ initialRoute: '그룹' });
      expect(mockGetMyChallengeResults).toHaveBeenCalledTimes(1);

      // 지연 시간 안에 사용자가 그룹 흐름을 벗어났다.
      await navigate('홈');
      const callsOnLeave = mockGetMyChallengeResults.mock.calls.length;

      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
      await act(async () => {});

      // 흐름 밖에서는 아무것도 쏘지 않는다 — gate도 그대로다.
      expect(mockGetMyChallengeResults).toHaveBeenCalledTimes(callsOnLeave);
      expect(getChallengeResultGate()).toBe('unknown');
    } finally {
      jest.useRealTimers();
    }
  });

  test('ack가 실패하면 **모달을 다시 띄우지 않고** ack만 재시도한다(N51)', async () => {
    // 재시도 지연(5초)을 실제로 기다리지 않으려고 이 테스트만 가짜 타이머로 돈다.
    jest.useFakeTimers();
    try {
      mockAck.mockResolvedValueOnce(false).mockResolvedValue(true);
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await renderHost();
      expect(screen.getByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(mockAck).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(6_000);
      });
      await act(async () => {});

      expect(mockAck).toHaveBeenCalledTimes(2);
      // 재시도는 **같은 세션·같은 토큰**으로 간다(멱등) — 값 자체는 계약이 아니다.
      expect(mockAck.mock.calls[1]).toEqual(mockAck.mock.calls[0]);
      // 재시도는 ack만이다 — 사용자에게 같은 결과를 두 번 보여주지 않는다.
      expect(screen.getByTestId('group.challengeResult')).toBeOnTheScreen();
      await closeModal();
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── ack 복구(N51) — 로컬 마커로 걸러진 회차가 서버엔 미확인으로 남는 구멍 ────────────
// 로컬 마커는 노출 시점에 찍히는데(D2) ack는 그 뒤에 실패할 수 있다. 그러면 다음 실행에서
// filterUnseenChallengeResults가 그 후보를 **버려** claim·ack 경로가 다시 열리지 않는다.
describe('ack 복구', () => {
  test('마커로 걸러진 회차라도 서버가 미확인이면 조용히 ack만 다시 보낸다', async () => {
    // 이미 본 회차 — 마커가 있어 큐에는 오르지 않는다.
    await AsyncStorage.setItem('gromo:sessionResult:me:s1', '2026-07-31');
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    mockPendingAck.mockResolvedValue([{ sessionId: 's1' }]);

    await renderHost();

    // 재노출은 없다 — 이미 본 것이 확실하다.
    expect(
      screen.queryByTestId('group.challengeResult', { includeHiddenElements: true }),
    ).toBeNull();
    // 그러나 서버 확인은 다시 시도한다.
    await waitFor(() => expect(mockPendingAck).toHaveBeenCalledWith('me', expect.any(Array)));
    await waitFor(() => expect(mockReconcileAck).toHaveBeenCalledWith('s1'));
  });

  // ⚠️ 대상 선정은 **이전 계정의 로컬 마커**로 하고, 실행은 **현재 전역 토큰**으로 나간다.
  //    그 사이 계정이 갈리면 새 계정이 아직 보지 않은 결과를 claim·ack 해 버린다 — 그 사용자는
  //    자기 결과를 영영 못 본다. 같은 회차에 두 계정이 참가하는 것은 실제로 가능하다(가드 키가
  //    계정 스코프인 이유가 그것이다).
  //    지금은 대역이 no-op이라 증상이 안 보이므로 **호출 여부**로 잠근다.
  test('대상 선정과 실행 사이에 계정이 바뀌면 복구를 실행하지 않는다', async () => {
    let releasePending: (entries: { sessionId: string }[]) => void = () => undefined;
    mockPendingAck.mockReturnValue(
      new Promise<{ sessionId: string }[]>((resolve) => {
        releasePending = resolve;
      }),
    );
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost();
    await waitFor(() => expect(mockPendingAck).toHaveBeenCalledTimes(1));

    // 대상 목록이 도착하기 전에 계정이 갈렸다(토큰 교체 = 인증 세대 증가).
    mockAuthGeneration.mockReturnValue(2);

    await act(async () => {
      releasePending([{ sessionId: 's1' }]);
    });
    await act(async () => {});

    // 이전 계정의 마커로 고른 대상을 **현재 계정의 토큰으로** 보내지 않는다.
    expect(mockReconcileAck).not.toHaveBeenCalled();
  });

  // ⚠️ 데이터층(PR #672)의 소유자 검증은 `getMyChallengeResults` 응답을 받은 자리에서 채우는
  //    **메모리 맵**이다. 그 조회에 없던 sessionId로 claim·ack을 걸면 맵이 비어 소유자 검증이
  //    무력화된다(토큰 고정만 남는다). 그래서 복구 대상은 **이번 조회가 돌려준 회차**로 자른다 —
  //    선정 함수가 저장소를 넓게 훑어 후보 밖 id를 돌려주더라도 호스트가 마지막에 막는다.
  test('복구 대상은 이번 조회가 돌려준 회차로 한정한다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]); // 이번 조회 = s1 하나
    mockPendingAck.mockResolvedValue([{ sessionId: 's1' }, { sessionId: 's-not-fetched' }]);

    await renderHost();

    await waitFor(() => expect(mockReconcileAck).toHaveBeenCalledWith('s1'));
    expect(mockReconcileAck).not.toHaveBeenCalledWith('s-not-fetched');
    expect(mockReconcileAck).toHaveBeenCalledTimes(1);
  });

  // 복구는 노출과 무관하게 서버를 수렴시키는 일이다 — 노출 ack 재시도 상한(5회)에 묶이면 안 된다.
  // 타이머 통도 분리돼 있다: 선점 재시도는 그룹 흐름에 묶이고(이탈 시 취소), ack·복구는 아니다.
  test('복구는 조회마다 새로 돈다 — 노출 재시도 상한에 묶이지 않는다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost();
    await waitFor(() => expect(mockPendingAck).toHaveBeenCalledTimes(1));

    // 상한(5)을 넘겨 조회를 반복한다.
    for (let i = 0; i < 6; i += 1) await betResultPush();

    expect(mockPendingAck).toHaveBeenCalledTimes(7);
  });

  test('복구가 실패해도 화면에 영향이 없다 — 조용한 수렴이다', async () => {
    mockPendingAck.mockRejectedValue(new Error('network'));
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);

    await renderHost();

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
  });
});

// ── 아래는 GroupRoomScreen.test.tsx의 '챌린지 결과 모달(GROMO-1279)' describe를 그대로 옮겨 온
//    계약이다. 소유자만 바뀌었을 뿐 지켜야 하는 것은 같다.
describe('챌린지 결과 모달(GROMO-1279)', () => {
  test('정산 결과가 있으면 모달을 띄우고, 같은 회차는 다시 띄우지 않는다(1회 가드)', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost();

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(screen.getByText('목표를 달성했어요!')).toBeOnTheScreen();
    expect(screen.getByText('7월 31일 결과')).toBeOnTheScreen();
    expect(screen.getByText('달성 1')).toBeOnTheScreen();
    expect(screen.getByText('미달성 1')).toBeOnTheScreen();
    expect(screen.getByText('내 정산 +30코인')).toBeOnTheScreen();
    expect(logGroupChallengeResultShown).toHaveBeenCalledWith({
      status: 'SETTLED',
      achieved: true,
      achiever_count: 1,
      member_count: 2,
    });
    // 1회 가드 마커 — 계정 스코프 세션 키, 값은 sessionDate(60일 프룬 기준 — IA §8).
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('gromo:sessionResult:me:s1')).toBe('2026-07-31');
    });
    // 잔액 동기화(PR #566 리뷰 ⑤) — 결과 큐는 그룹 무관 소스라 화면 서명 비교가 못 잡는다.
    expect(mockRefreshCoins).toHaveBeenCalled();

    await closeModal();
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    expect(logGroupChallengeResultClosed).toHaveBeenCalled();

    // 다음 조회가 같은 결과를 받아도 다시 띄우지 않는다 — 1회 가드.
    await betResultPush();
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    expect(logGroupChallengeResultShown).toHaveBeenCalledTimes(1);
  });

  test('sessionDate 내림차순 순차 큐 — 최근 것부터, 닫으면 다음이 뜬다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([
      resultEntry({ sessionId: 's-old', sessionDate: '2026-07-30', myAchieved: false }),
      resultEntry({ sessionId: 's-new', sessionDate: '2026-07-31', myAchieved: true }),
    ]);
    await renderHost();

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(screen.getByText('7월 31일 결과')).toBeOnTheScreen(); // 최근 것부터

    await closeModal();
    expect(screen.getByText('7월 30일 결과')).toBeOnTheScreen(); // 다음 장

    await closeModal();
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
  });

  test('무산(인원 부족)도 결과다 — 환불 문구로 알린다(IA §4.3)', async () => {
    mockGetMyChallengeResults.mockResolvedValue([
      resultEntry({
        status: 'VOIDED',
        voidReason: 'SHORT_PARTICIPANTS',
        myAchieved: null,
        myPayout: null,
      }),
    ]);
    await renderHost();

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(
      screen.getByText('참가자가 부족해 무산됐어요 · 참가비는 돌려드렸어요'),
    ).toBeOnTheScreen();
  });

  // 삭제 환불은 BET_VOID_REFUND 푸시가 알린다 — 모달까지 띄우면 같은 사건 이중 통지(N48).
  test('삭제된 챌린지의 회차는 띄우지 않는다(N48 — 푸시와 이중 통지 금지)', async () => {
    mockGetMyChallengeResults.mockResolvedValue([
      resultEntry({ status: 'VOIDED', voidReason: 'CHALLENGE_DELETED' }),
      resultEntry({ sessionId: 's-del', challengeDeleted: true }),
    ]);
    await renderHost();

    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    // '없다'가 확정됐다 — 그룹방의 탈퇴 유예가 이 신호로 풀린다.
    await waitFor(() => expect(getChallengeResultGate()).toBe('none'));
  });

  test('조회가 실패하면 "없다"가 아니라 "모른다"로 남는다(D1)', async () => {
    mockGetMyChallengeResults.mockRejectedValue(new Error('network'));
    await renderHost();

    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    expect(getChallengeResultGate()).toBe('unknown');
  });

  test('1회 가드 읽기가 실패해도 "모른다"로 남는다 — 회복된 다음 조회가 띄운다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    // ⚠️ jest.spyOn + mockRestore 는 쓰지 않는다 — 공식 AsyncStorage mock의 메서드는 이미
    //    jest.fn 이라, 복원하면 구현이 사라져 이후 모든 multiGet이 undefined를 돌려준다.
    (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(new Error('storage'));
    await renderHost();

    expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    expect(getChallengeResultGate()).toBe('unknown');

    await betResultPush();
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
  });

  // 성공 응답은 빈 배열도 정본이다(codex 후속 리뷰 P2). 예전엔 후보 0건이면 큐 반영 자체를
  // 건너뛰어, 가려져 대기하던 결과가 서버에서 제외된 뒤에도 살아남았다.
  describe('성공한 빈 응답의 큐 반영', () => {
    test('가려져 대기하던 결과가 서버에서 빠지면 큐에서도 사라진다(N48)', async () => {
      const view = await renderHost({ sheetOpen: true });

      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await betResultPush();
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      // 그 사이 다른 기기에서 챌린지가 삭제돼 서버가 이 회차를 응답에서 제외했다(FR-44-4).
      mockGetMyChallengeResults.mockResolvedValue([]);
      await betResultPush();

      // 시트를 닫아도 사라진 결과가 되살아나선 안 된다 — 환불 푸시가 이미 알린 사건이다.
      await act(async () => {
        view.rerender(<Harness initialRoute="그룹" sheetOpen={false} />);
      });
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });

    test('실제로 떠 있는 모달은 빈 응답에도 걷어내지 않는다', async () => {
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await renderHost();
      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();

      mockGetMyChallengeResults.mockResolvedValue([]);
      await betResultPush();
      expect(screen.getByTestId('group.challengeResult')).toBeOnTheScreen();

      // 닫으면 정본대로 비어 있다 — 뒤에 남아 있던 장이 따라 뜨지 않는다.
      await closeModal();
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });

    test('조회 실패는 대기 큐를 건드리지 않는다 — 네트워크 실패로 결과를 잃지 않는다', async () => {
      const view = await renderHost({ sheetOpen: true });

      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await betResultPush();

      mockGetMyChallengeResults.mockRejectedValue(new Error('network'));
      await betResultPush();

      await act(async () => {
        view.rerender(<Harness initialRoute="그룹" sheetOpen={false} />);
      });
      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    });
  });

  // ── 챌린지 종료 푸시 딥링크(GROMO-1088) ──
  // 푸시를 탭해서 들어오면 GroupRoom 라우트 파라미터에 challengeId가 실린다. 사용자가 알림을
  // 직접 누른 명시적 요청이라 1회 가드를 넘어서 열되, **한 번만** 소비돼야 한다.
  describe('종료 푸시가 지목한 챌린지(라우트 challengeId)', () => {
    async function landOnPush(challengeId: string) {
      await renderHost({ initialRoute: '홈' });
      await navigate('GroupRoom', { groupId: GROUP_ID, challengeId });
    }

    // SESSION_END 푸시는 정산 **전**에 온다 — 방금 끝난 회차는 아직 큐에 없고, 있는 것은 지난
    // (이미 본) 회차뿐이다. 이때 seen 우회로 지난 회차를 재노출하며 지목을 소비하면, 새 결과가
    // 정산돼 도착했을 때 지목이 죽어 있다(PR #566 리뷰 ③).
    test('매치가 전부 본 결과뿐이면 재노출하지 않고 지목을 유지한다', async () => {
      await AsyncStorage.setItem('gromo:sessionResult:me:s1', '2026-07-31');
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]); // s1 — 이미 본 지난 회차

      await landOnPush('c1');
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      // 정산이 끝나 새 회차가 도착한 재조회 — 유지된 지목이 그때 소비된다.
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry(),
        resultEntry({ sessionId: 's2', sessionDate: '2026-08-01' }),
      ]);
      await betResultPush();

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(screen.getByText('8월 1일 결과')).toBeOnTheScreen();
    });

    test('닫은 뒤 재조회에서 다시 뜨지 않는다(1회 소비 + 노출 가드)', async () => {
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await landOnPush('c1');
      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      await closeModal();

      await betResultPush();
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });

    test('아직 정산 전이면 소비하지 않고 다음 조회가 이어받는다', async () => {
      mockGetMyChallengeResults.mockResolvedValue([]);
      await landOnPush('c1');
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
      await betResultPush();
      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    });

    test('지목한 챌린지의 결과를 큐 앞자리에 세운다(다른 결과보다 먼저)', async () => {
      // 최신순 정렬로는 s-other(7/31)가 먼저다 — 지목이 그 앞을 차지해야 한다.
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's-other', challengeId: 'c-other', sessionDate: '2026-07-31' }),
        resultEntry({ sessionId: 's-target', challengeId: 'c-target', sessionDate: '2026-07-30' }),
      ]);

      await landOnPush('c-target');

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(screen.getByText('7월 30일 결과')).toBeOnTheScreen();
    });

    // 요일 반복(N3)에서는 같은 challengeId의 지난 회차가 큐(30일)에 여럿 남는다 — 푸시는
    // challengeId만 싣기 때문에 전부 우회시키면 이미 본 지난 회차까지 재노출된다.
    test('같은 챌린지의 지난 회차가 여럿이어도 가드 우회는 최신 1건뿐이다', async () => {
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's-new', challengeId: 'c-target', sessionDate: '2026-07-31' }),
        resultEntry({ sessionId: 's-old', challengeId: 'c-target', sessionDate: '2026-07-28' }),
        resultEntry({ sessionId: 's-older', challengeId: 'c-target', sessionDate: '2026-07-25' }),
      ]);
      await AsyncStorage.setItem('gromo:sessionResult:me:s-old', '2026-07-28');
      await AsyncStorage.setItem('gromo:sessionResult:me:s-older', '2026-07-25');

      await landOnPush('c-target');

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(screen.getByText('7월 31일 결과')).toBeOnTheScreen();
      await closeModal();
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });

    test('지목이 없으면(탭 진입) 기존 1회 가드가 그대로 막는다', async () => {
      await AsyncStorage.setItem('gromo:sessionResult:me:s1', '2026-07-31');
      mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);

      await renderHost({ initialRoute: '그룹' });

      expect(screen.queryByTestId('group.challengeResult')).toBeNull();
    });

    // 결과 푸시로 들어온 뒤 **정산 전에** 하위 화면으로 이동하면 라우트에서 challengeId가
    // 사라진다. 그때 지목을 버리면 뒤늦게 정산이 끝났을 때 사용자가 탭한 챌린지가 아니라
    // 다른 최신 결과가 먼저 뜬다 — 내부 이동은 상태를 리셋할 사건이 아니다.
    test('그룹 흐름 **내부**로 이동해도 지목을 잃지 않는다', async () => {
      mockGetMyChallengeResults.mockResolvedValue([]); // 아직 정산 전
      await renderHost({ initialRoute: '홈' });
      await navigate('GroupRoom', { groupId: GROUP_ID, challengeId: 'c-target' });
      expect(screen.queryByTestId('group.challengeResult')).toBeNull();

      // 방에서 그룹 설정으로 들어갔다 — challengeId가 없는 라우트다.
      await navigate('GroupSettings', { groupId: GROUP_ID });

      // 그 사이 정산이 끝났다. 최신순으로는 s-other(7/31)가 앞이지만, 사용자가 탭한 것은
      // c-target(7/30)이다.
      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's-other', challengeId: 'c-other', sessionDate: '2026-07-31' }),
        resultEntry({ sessionId: 's-target', challengeId: 'c-target', sessionDate: '2026-07-30' }),
      ]);
      await betResultPush();

      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(screen.getByText('7월 30일 결과')).toBeOnTheScreen();
    });

    // 반대 축 — 그룹 흐름을 **완전히** 벗어나면 지목은 그 진입의 사건과 함께 끝난다.
    test('그룹 흐름을 벗어나면 지목을 버린다 — 다음 진입은 새 사건이다', async () => {
      mockGetMyChallengeResults.mockResolvedValue([]);
      await renderHost({ initialRoute: '홈' });
      await navigate('GroupRoom', { groupId: GROUP_ID, challengeId: 'c-target' });
      await navigate('홈');

      mockGetMyChallengeResults.mockResolvedValue([
        resultEntry({ sessionId: 's-other', challengeId: 'c-other', sessionDate: '2026-07-31' }),
        resultEntry({ sessionId: 's-target', challengeId: 'c-target', sessionDate: '2026-07-30' }),
      ]);
      await navigate('그룹');

      // 지목이 살아 있었다면 7/30이 먼저 떴을 것이다 — 이제는 평범한 최신순이다.
      expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
      expect(screen.getByText('7월 31일 결과')).toBeOnTheScreen();
    });
  });
});

// ── 그룹 흐름 이탈은 이 진입의 상태를 통째로 끝낸다 ──────────────────────────────
// 모달이 떠 있는 중에 다른 딥링크가 홈으로 데려갈 수 있다. 그 사이 다른 기기가 그 결과를
// ack 하면, 돌아왔을 때 서버는 그 회차를 더 이상 주지 않는다. 그런데 노출·선점 상태를 들고
// 있으면 `load()`의 shown-head 병합이 그것을 되살리고, 낡은 claim을 재검증 없이 재사용한다.
describe('그룹 흐름 이탈 시 상태 폐기', () => {
  test('서버가 더 이상 주지 않는 결과는 재진입 때 되살아나지 않는다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost({ initialRoute: '그룹' });
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();

    // 다른 딥링크가 그룹 흐름 밖으로 데려갔다 — 모달은 내려간다.
    await navigate('홈');
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();

    // 그 사이 다른 기기가 이 결과를 확인했다 — 서버 큐에서 빠진다.
    mockGetMyChallengeResults.mockResolvedValue([]);
    await navigate('그룹');

    // shown-head 병합이 살아 있었다면 여기서 되살아났을 것이다.
    expect(
      screen.queryByTestId('group.challengeResult', { includeHiddenElements: true }),
    ).toBeNull();
  });

  // ⚠️ 이탈 시 폐기(위)는 **이탈 시점의 상태**를 버린다. 그런데 그 전에 날아간 조회의 응답은
  //    그 뒤에 도착한다. seq만 보면 그 요청은 여전히 '최신'이라 큐와 **모듈 전역** gate를
  //    되살린다. gate가 전역이라는 점이 특히 위험하다 — 탈퇴 유예 중인 GroupRoom이 다른 화면
  //    **아래에** 남아 있으면, 죽은 요청이 세운 'none'이 그 방의 구독을 깨워 goBack()을 부르고
  //    지금 보고 있는 화면을 팝한다.
  test('조회 도중 그룹 흐름을 벗어나면 늦게 도착한 응답이 gate를 바꾸지 않는다', async () => {
    // 조회를 손으로 붙잡아 "요청은 날아갔고 응답은 아직"인 구간을 만든다.
    let releaseResults: (entries: MyChallengeResultEntry[]) => void = () => undefined;
    mockGetMyChallengeResults.mockReturnValue(
      new Promise<MyChallengeResultEntry[]>((resolve) => {
        releaseResults = resolve;
      }),
    );
    await renderHost({ initialRoute: '그룹' });
    await waitFor(() => expect(mockGetMyChallengeResults).toHaveBeenCalledTimes(1));
    expect(getChallengeResultGate()).toBe('unknown');

    // 사용자가 그룹 흐름을 벗어났다 — 이 시점에 상태는 이미 폐기됐다.
    await navigate('홈');

    // 이제 죽은 요청의 응답이 도착한다. '없다'(none)도 '있다'(pending)도 말하면 안 된다.
    await act(async () => {
      releaseResults([]);
    });
    await act(async () => {});

    expect(getChallengeResultGate()).toBe('unknown');
    expect(
      screen.queryByTestId('group.challengeResult', { includeHiddenElements: true }),
    ).toBeNull();
  });

  test('재진입하면 선점을 처음부터 다시 검증한다 — 낡은 claim을 재사용하지 않는다', async () => {
    // 같은 회차가 재진입 뒤에도 서버 큐에 남아 있어야 이 경로가 성립한다. 그 조건은 실제로
    // 있다 — **로컬 마커 쓰기가 실패한 경우**다(markChallengeResultSeen은 실패를 삼킨다).
    // 그때 낡은 claim을 재사용하면 재검증 없이 그대로 다시 띄운다.
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('storage'));
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost({ initialRoute: '그룹' });
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    await waitFor(() =>
      expect(AsyncStorage.getItem('gromo:sessionResult:me:s1')).resolves.toBeNull(),
    );
    const beforeLeave = mockClaim.mock.calls.length;

    await navigate('홈');
    await navigate('그룹');

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    // 획득 + 재검증이 새로 돌았다 — 낡은 토큰을 그대로 쓰면 호출이 늘지 않는다.
    expect(mockClaim.mock.calls.length).toBeGreaterThan(beforeLeave);
    expect(mockClaim).toHaveBeenLastCalledWith('s1', expect.any(String));
  });
});

// ── RESULT_NOT_SETTLED(409) — 정산 전 회차 ──────────────────────────────────────
// 재시도 대상이 **아니다.** 기다린다고 열리지 않고(정산은 서버 배치다), 큐 머리를 붙들면
// 뒤의 결과까지 막는다.
describe('정산 전 회차는 후보에서 제외한다', () => {
  test('재시도하지 않고 큐에서 빼며, 뒤의 결과가 곧바로 뜬다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([
      resultEntry({ sessionId: 's-open', sessionDate: '2026-07-31' }),
      resultEntry({ sessionId: 's-done', sessionDate: '2026-07-30' }),
    ]);
    mockClaim.mockImplementation(async (sessionId: string, currentToken?: string) =>
      sessionId === 's-open'
        ? { ok: false as const, retryAfterMs: null, notSettled: true }
        : { ok: true as const, claimToken: currentToken ?? 'tok-done' },
    );

    await renderHost();

    // 정산 전 회차(7/31)는 건너뛰고 뒤의 결과(7/30)가 뜬다 — 기다리지 않는다.
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(screen.getByText('7월 30일 결과')).toBeOnTheScreen();
    // 본 적이 없는 회차이므로 로컬 가드도 찍지 않는다.
    expect(await AsyncStorage.getItem('gromo:sessionResult:me:s-open')).toBeNull();
  });
});

// ── 가려진 채 seen/ack 되지 않는다 ─────────────────────────────────────────────
// 이 배치의 핵심 실패 모드다. 로컬 마커와 ack는 **둘 다 노출 시점**에 찍히므로(D2 · N51),
// 다른 RN Modal에 덮인 채 마운트되면 사용자는 한 번도 못 봤는데 서버·로컬 모두 "봤다"가 된다.
// 그래서 slot을 못 얻은 결과는 **마운트 자체가 없어야** 하고, 그 사실을 부작용으로도 확인한다.
describe('가려진 채 확인 처리되지 않는다', () => {
  // ⚠️ 시트 중에는 **탭과 마운트 사이에 await가 있는 것**이 있다(ChallengeCard.openWeekSheet).
  //    그 사이 우리가 slot을 먼저 얻으면, 조정자는 보유자를 뺏지 않으므로 시트가 그대로 우리
  //    위에 마운트되고 그 아래에서 seen/ack이 찍힌다. 그래서 **아직 노출 전이면 물러난다.**
  test('이미 slot을 쥔 뒤에 시트가 등록해도 — 노출 전이면 물러나 두 Modal이 겹치지 않는다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    // 선점 응답을 붙잡아 "slot은 얻었지만 아직 노출 전"인 구간을 만든다 —
    // 비동기로 열리는 시트가 끼어드는 바로 그 창이다.
    let releaseClaim: (value: { ok: true; claimToken: string }) => void = () => undefined;
    mockClaim.mockImplementationOnce(
      () =>
        new Promise<{ ok: true; claimToken: string }>((resolve) => {
          releaseClaim = resolve;
        }),
    );
    const view = await renderHost({ initialRoute: '그룹', sheetOpen: false });
    await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));

    // 시트가 자기 조회를 마치고 이제서야 등록한다(우리는 이미 보유자다).
    await act(async () => {
      view.rerender(<Harness initialRoute="그룹" sheetOpen />);
    });
    await act(async () => {
      releaseClaim({ ok: true, claimToken: 'tok-late' });
    });
    await act(async () => {});

    // 물러났으므로 모달은 마운트되지 않고, 그 아래에서 확인 처리되지도 않는다.
    expect(
      screen.queryByTestId('group.challengeResult', { includeHiddenElements: true }),
    ).toBeNull();
    expect(await AsyncStorage.getItem('gromo:sessionResult:me:s1')).toBeNull();
    expect(mockAck).not.toHaveBeenCalled();

    // 시트가 닫히면 그때 정상적으로 뜬다 — 결과를 잃지 않는다.
    await act(async () => {
      view.rerender(<Harness initialRoute="그룹" sheetOpen={false} />);
    });
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
  });

  test('slot을 못 얻으면 마운트도 seen 마커도 ack도 없다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    const view = await renderHost({ initialRoute: '그룹', sheetOpen: true });

    expect(
      screen.queryByTestId('group.challengeResult', { includeHiddenElements: true }),
    ).toBeNull();
    // 노출의 부작용 셋 중 어느 것도 일어나지 않았다.
    expect(await AsyncStorage.getItem('gromo:sessionResult:me:s1')).toBeNull();
    expect(mockAck).not.toHaveBeenCalled();
    expect(logGroupChallengeResultShown).not.toHaveBeenCalled();

    // 가린 것이 사라지면 그때 정상적으로 노출·확인된다.
    await act(async () => {
      view.rerender(<Harness initialRoute="그룹" sheetOpen={false} />);
    });
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    await waitFor(() => expect(mockAck).toHaveBeenCalledTimes(1));
  });
});

// ── 비활성 구간을 건너뛴 선점 응답 ────────────────────────────────────────────
// 재검증 응답이 도착한 **직후 JS가 백그라운드에서 정지**하면, 2분 lease가 만료되고 다른 기기가
// 재선점한 뒤에도 복귀 시 그 낡은 값을 그대로 믿게 된다 — 재검증 단계가 그 구간에는 무의미하다.
// ── 비활성 구간에서는 아무것도 기록하지 않는다 ─────────────────────────────────
// 같은 뿌리의 결함이 이 배치에서 세 번 나왔다: 코치마크에 가린 채 ack · 비동기 시트가 한 프레임
// 뒤에 덮음 · 그리고 이것. 셋 다 **"사용자가 봤다"를 렌더 커밋으로 근사**한 데서 온다.
// 렌더가 커밋돼도 앱이 inactive·background면 사용자는 아무것도 못 본다.
describe('비활성 상태에서는 노출·확인이 없다', () => {
  test('비활성 중에 큐가 채워져도 마커도 ack도 계측도 기록되지 않는다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([]);
    await renderHost({ initialRoute: '그룹' });

    // 앱이 화면에서 내려갔다.
    await act(async () => {
      appStateHandler?.('background');
    });

    // 그 사이 진행 중이던 조회가 결과를 가져온다(주기 재조회·BET_RESULT 수신 등).
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await betResultPush();

    // 선점조차 시작하지 않는다 — 노출의 부작용 셋 중 어느 것도 없다.
    expect(mockClaim).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('group.challengeResult', { includeHiddenElements: true }),
    ).toBeNull();
    expect(await AsyncStorage.getItem('gromo:sessionResult:me:s1')).toBeNull();
    expect(mockAck).not.toHaveBeenCalled();
    expect(logGroupChallengeResultShown).not.toHaveBeenCalled();

    // 복귀가 재시도를 깨운다 — 결과를 잃지 않는다.
    await act(async () => {
      appStateHandler?.('active');
    });
    await act(async () => {});

    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    await waitFor(() => expect(mockAck).toHaveBeenCalledTimes(1));
  });

  test('노출 중 비활성이 되면 모달을 내리고, 복귀해도 다시 확인 처리하지 않는다', async () => {
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost({ initialRoute: '그룹' });
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    await waitFor(() => expect(mockAck).toHaveBeenCalledTimes(1));

    await act(async () => {
      appStateHandler?.('inactive');
    });
    expect(screen.queryByTestId('group.challengeResult')).toBeNull();

    await act(async () => {
      appStateHandler?.('active');
    });
    await act(async () => {});

    // 같은 회차를 두 번 확인 처리하지 않는다(노출 1회 가드는 그대로다).
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(logGroupChallengeResultShown).toHaveBeenCalledTimes(1);
  });
});

describe('포그라운드 복귀 시 선점 재검증', () => {
  test('비활성 구간을 건너뛴 응답은 폐기하고 다시 검증한다', async () => {
    let releaseClaim: (value: { ok: true; claimToken: string }) => void = () => undefined;
    // 첫 라운드는 응답을 손으로 붙잡는다.
    mockClaim.mockImplementationOnce(
      () =>
        new Promise<{ ok: true; claimToken: string }>((resolve) => {
          releaseClaim = resolve;
        }),
    );
    mockGetMyChallengeResults.mockResolvedValue([resultEntry()]);
    await renderHost();
    await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));

    // 응답을 기다리는 사이 앱이 내려갔다 올라왔다 — 그 구간에 lease가 만료됐을 수 있다.
    await act(async () => {
      appStateHandler?.('background');
    });
    await act(async () => {
      appStateHandler?.('active');
    });

    // 이제 낡은 응답이 도착한다. 이것을 믿고 노출하면 두 기기가 같은 결과를 동시에 본다.
    await act(async () => {
      releaseClaim({ ok: true, claimToken: 'stale-token' });
    });
    await act(async () => {});

    // 낡은 토큰으로는 ack 하지 않는다 — 처음부터 다시 검증한 뒤에야 노출한다.
    expect(await screen.findByTestId('group.challengeResult')).toBeOnTheScreen();
    await waitFor(() => expect(mockAck).toHaveBeenCalledTimes(1));
    expect(mockAck).not.toHaveBeenCalledWith('s1', 'stale-token');
    // 폐기 → 재시도이므로 선점이 다시 돌았다(첫 라운드 1회 + 새 라운드의 획득·재검증).
    expect(mockClaim.mock.calls.length).toBeGreaterThan(2);
  });
});
