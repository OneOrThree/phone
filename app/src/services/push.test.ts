// 푸시 딥링크 배선 + 사일런트 flush 테스트 — 정본 IA §4.2 (GROMO-1421 · GROMO-1286).
//
// 여기서 잠그는 것:
//  1) 세 경로(백그라운드 배너 탭·포그라운드 로컬 알림 탭·콜드스타트) 모두 서버가 실어 보낸
//     data.link를 그대로 navigateToDeepLink로 흘린다 — 링크 문법이 서버·앱 계약이다.
//  2) link 없는 그룹 푸시는 타입별로 groupId → 그룹방 딥링크를 합성한다(IA §4.2 payload 표) —
//     서버는 link를 싣지 않는 계약이라 이 배선이 없으면 탭해도 아무 데도 안 간다.
//  3) BET_VOID_REFUND는 그룹방까지만 — challenge 파라미터를 싣지 않는다(N48 이중 통지 금지).
//  4) 미지원 타입 + groupId는 그룹 탭 폴백 — 크래시·무반응 금지.
//  5) 사일런트(data.silent='flush') 수신 → 업로드 큐 flush(창 사용분 먼저 — 1420과 같은 축).
//     백그라운드 등록은 pushBackground.registerBackgroundFlushHandler(index.ts 최상위) 몫이다 —
//     PushGate 이펙트 등록만으로는 종료 상태 headless 기동에서 no-op이 메시지를 삼킨다(리뷰 ①).
import { handleInitialNotification, setupPushListeners } from './push';
import { registerBackgroundFlushHandler } from './pushBackground';
import { navigateToDeepLink } from '@/navigation/navigationRef';
// 정산 결과 재조회 신호(GROMO-1580 ④) — **실물 모듈**을 구독한다(스텁 오버라이드 금지).
import { subscribeBetResultPush } from '@/services/betResultSignal';
import {
  flushPendingFocusUploads,
  markBackgroundFocusCommit,
} from '@/screens/focus/pendingFocusUploads';
import { syncWindowUsage } from '@/services/screentimeSync';

jest.mock('@/navigation/navigationRef', () => ({ navigateToDeepLink: jest.fn() }));
jest.mock('@/services/api', () => ({
  api: { put: jest.fn() },
  getFreshAccessToken: jest.fn(async () => 'token'),
  getUserIdFromToken: jest.fn(() => 'me'),
}));
jest.mock('@/services/notificationInbox', () => ({ addToInbox: jest.fn() }));
jest.mock('@/screens/focus/pendingFocusUploads', () => ({
  flushPendingFocusUploads: jest.fn(async () => false),
  markBackgroundFocusCommit: jest.fn(async () => {}),
}));
jest.mock('@/services/screentimeSync', () => ({
  syncWindowUsage: jest.fn(async () => {}),
}));
// 백그라운드 커밋이 트리를 깨우는 신호 — 실제 재조회는 CoinProvider가 한다.
jest.mock('@/store/coinRefreshSignal', () => ({ requestCoinRefresh: jest.fn() }));
jest.mock('@/services/analyticsEvents', () => ({
  logNotificationOpened: jest.fn(),
  logNotificationPermissionResult: jest.fn(),
  logPushOpened: jest.fn(),
}));

// 포그라운드 응답 리스너를 테스트가 직접 굴린다.
let responseHandler: ((resp: unknown) => void) | null = null;
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn((cb: (resp: unknown) => void) => {
    responseHandler = cb;
    return { remove: jest.fn() };
  }),
}));

// @react-native-firebase/messaging은 네이티브 모듈이라 통째로 대체한다.
// messaging()이 매번 같은 객체를 돌려줘야 리스너 등록/조회가 한 곳으로 모인다.
let openedHandler: ((msg: unknown) => void) | null = null;
let messageHandler: ((msg: unknown) => Promise<void>) | null = null;
let backgroundHandler: ((msg: unknown) => Promise<void>) | null = null;
const mockGetInitialNotification = jest.fn(async () => null as unknown);
jest.mock('@react-native-firebase/messaging', () => {
  const instance = {
    onTokenRefresh: jest.fn(() => jest.fn()),
    onMessage: jest.fn((cb: (msg: unknown) => Promise<void>) => {
      messageHandler = cb;
      return jest.fn();
    }),
    onNotificationOpenedApp: jest.fn((cb: (msg: unknown) => void) => {
      openedHandler = cb;
      return jest.fn();
    }),
    setBackgroundMessageHandler: jest.fn((cb: (msg: unknown) => Promise<void>) => {
      backgroundHandler = cb;
    }),
    getInitialNotification: () => mockGetInitialNotification(),
  };
  const messaging = () => instance;
  messaging.AuthorizationStatus = { NOT_DETERMINED: -1, AUTHORIZED: 1, PROVISIONAL: 2 };
  return { __esModule: true, default: messaging };
});

const mockNavigateToDeepLink = navigateToDeepLink as jest.MockedFunction<typeof navigateToDeepLink>;
const mockFlushFocus = flushPendingFocusUploads as jest.Mock;
const mockMarkBackgroundCommit = markBackgroundFocusCommit as jest.Mock;
const mockRequestCoinRefresh = jest.requireMock('@/store/coinRefreshSignal')
  .requestCoinRefresh as jest.Mock;
const mockSyncWindow = syncWindowUsage as jest.Mock;
const { getFreshAccessToken } = jest.requireMock('@/services/api');
const { scheduleNotificationAsync } = jest.requireMock('expo-notifications');

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const CHALLENGE_ID = '0198aa11-2b3c-7d4e-8f50-6a7b8c9d0e1f';
const END_LINK = `gromo://group?g=${GROUP_ID}&challenge=${CHALLENGE_ID}`;

// 표시용 payload가 있는 원격 메시지(보관함 저장 분기까지 태운다).
function message(data: Record<string, unknown>) {
  return {
    messageId: 'm1',
    sentTime: 1785000000000,
    notification: { title: '챌린지가 끝났어요', body: '결과를 확인해 보세요' },
    data,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getFreshAccessToken.mockResolvedValue('token');
  // clearAllMocks는 호출 기록만 지운다 — 앞선 테스트가 심은 구현(mockRejectedValue 등)이
  // 남아 뒤 테스트를 오염시키지 않도록 기본 동작을 매번 되돌린다.
  mockFlushFocus.mockResolvedValue(false);
  mockSyncWindow.mockResolvedValue(undefined);
  mockMarkBackgroundCommit.mockResolvedValue(undefined);
  openedHandler = null;
  messageHandler = null;
  backgroundHandler = null;
  responseHandler = null;
});

describe('data.link 3경로 전달(GROMO-1088 유지)', () => {
  test('백그라운드 배너 탭 — data.link를 그대로 흘린다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'CHALLENGE_ENDED', link: END_LINK }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(END_LINK);
  });

  test('포그라운드 로컬 알림 탭 — data.link를 그대로 흘린다', () => {
    setupPushListeners();
    responseHandler?.({
      notification: {
        request: { content: { data: { type: 'CHALLENGE_ENDED', link: END_LINK } } },
      },
    });

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(END_LINK);
  });

  // initialNotificationHandled는 **모듈 상태**(앱 실행당 1회)라 이 파일에서 한 번만 소비된다 —
  // 링크 전달과 재호출 가드를 한 테스트에서 함께 잠근다. PushGate가 재로그인(userId 변경)마다
  // 다시 불러도 캐시된 콜드스타트 딥링크로 재이동하지 않는다는 성질이 challenge를 실어도 유지된다.
  test('콜드스타트 — data.link를 그대로 흘리고, 재호출은 이동하지 않는다', async () => {
    mockGetInitialNotification.mockResolvedValue(
      message({ type: 'CHALLENGE_ENDED', link: END_LINK }),
    );

    await handleInitialNotification();
    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(END_LINK);

    await handleInitialNotification();
    expect(mockNavigateToDeepLink).toHaveBeenCalledTimes(1);
  });
});

// 서버는 link를 싣지 않는다(IA §4.2) — 앱이 타입별로 groupId → 딥링크를 합성한다(GROMO-1421).
// 결과성 타입(BET_RESULT·BET_WON·BET_VOID_REFUND·SESSION_END)은 result=1 표식을 함께 싣는다 —
// 탈퇴자도 정산 통지에 도달해야 해서(N53·C8) navigationRef가 이 표식만 멤버십 게이트를 우회한다.
describe('link 없는 그룹 푸시의 딥링크 합성(IA §4.2 payload 표)', () => {
  // 비결과성(모집·생성) — 그룹방까지만, 멤버십 게이트 유지(result 표식 없음).
  test.each(['CHALLENGE_CREATED', 'CHALLENGE_SESSION_OPEN'])(
    '%s + groupId → 그룹방 딥링크(challenge·result 없음)',
    (type) => {
      setupPushListeners();
      openedHandler?.(message({ type, groupId: GROUP_ID, challengeId: CHALLENGE_ID }));

      expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`gromo://group?g=${GROUP_ID}`);
    },
  );

  // 결과성 — 특정 챌린지를 지목하지 않는 타입들(묶음 발송 포함). result=1만 붙는다.
  test.each(['BET_RESULT', 'BET_WON'])('%s + groupId → 그룹방 딥링크 + result 표식', (type) => {
    setupPushListeners();
    openedHandler?.(message({ type, groupId: GROUP_ID, challengeId: CHALLENGE_ID }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`gromo://group?g=${GROUP_ID}&result=1`);
  });

  // 종료 푸시는 **두 타입뿐**이다(계약 §2 · 결정 N02): CHALLENGE_WINDOW_END(창형) ·
  // CHALLENGE_ENDED(일 목표형). 서버는 둘 다 link를 채워 보내지만, 빠져도 지목(challengeId)을
  // 잃지 않아야 한다 — 예전엔 이 합성이 서버에 없는 'CHALLENGE_SESSION_END'에만 걸려 있어
  // 일 목표형은 groupId까지 통째로 잃고 그룹 탭 폴백으로 떨어졌다.
  test.each(['CHALLENGE_WINDOW_END', 'CHALLENGE_ENDED'])(
    '%s + challengeId → 그룹방 + 그 챌린지 지목(challenge)',
    (type) => {
      setupPushListeners();
      openedHandler?.(message({ type, groupId: GROUP_ID, challengeId: CHALLENGE_ID }));

      expect(mockNavigateToDeepLink).toHaveBeenCalledWith(END_LINK);
    },
  );

  test.each(['CHALLENGE_WINDOW_END', 'CHALLENGE_ENDED'])(
    '%s인데 challengeId가 없으면(묶음) 그룹방까지만',
    (type) => {
      setupPushListeners();
      openedHandler?.(message({ type, groupId: GROUP_ID }));

      expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`gromo://group?g=${GROUP_ID}`);
    },
  );

  // 종료 푸시에는 멤버십 게이트 우회(result=1)를 싣지 않는다 — 정산 **전**에 오는 그룹 스코프
  // 공지라, 참가자 스코프 사건(정산 결과·환불)이 근거인 그 우회의 대상이 아니다.
  test.each(['CHALLENGE_WINDOW_END', 'CHALLENGE_ENDED'])('%s에는 result 표식이 없다', (type) => {
    setupPushListeners();
    openedHandler?.(message({ type, groupId: GROUP_ID, challengeId: CHALLENGE_ID }));

    expect(mockNavigateToDeepLink.mock.calls[0][0]).not.toContain('result=1');
  });

  // 삭제 환불은 이 푸시가 알리는 사건이다 — 결과 모달까지 열면 같은 사건 이중 통지(N48).
  // challengeId가 실려 와도 challenge 파라미터를 합성하지 않는다.
  // 대신 refund=1을 싣는다(codex 리뷰 P2) — 삭제된 챌린지는 결과 모달 대상에서 빠지고
  // 챌린지 목록에도 안 남아, 표식이 없으면 잔액을 다시 받을 경로가 하나도 없다.
  test('BET_VOID_REFUND → 그룹방까지만 + 잔액 재조회 표식(N48 · 이중 통지 금지)', () => {
    setupPushListeners();
    openedHandler?.(
      message({
        type: 'BET_VOID_REFUND',
        groupId: GROUP_ID,
        challengeId: CHALLENGE_ID,
        voidReason: 'CHALLENGE_DELETED',
      }),
    );

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(
      `gromo://group?g=${GROUP_ID}&result=1&refund=1`,
    );
  });

  // 환불 표식은 환불 타입에만 붙는다 — 다른 결과성 푸시는 결과 모달·정산 서명 경로가 이미
  // 잔액을 다시 받으므로(GroupRoomScreen), 여기에 표식을 늘리면 같은 일을 두 번 시킨다.
  test.each(['BET_RESULT', 'BET_WON', 'CHALLENGE_WINDOW_END', 'CHALLENGE_CREATED'])(
    '%s에는 환불 표식(refund)을 싣지 않는다',
    (type) => {
      setupPushListeners();
      openedHandler?.(message({ type, groupId: GROUP_ID }));

      expect(mockNavigateToDeepLink).toHaveBeenCalledTimes(1);
      expect(mockNavigateToDeepLink.mock.calls[0][0]).not.toContain('refund');
    },
  );

  test('미지원 타입 + groupId는 그룹 탭 폴백 — 무반응으로 끝나지 않는다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'SOME_FUTURE_TYPE', groupId: GROUP_ID }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith('gromo://group');
  });

  test('타입도 link도 없으면 이동하지 않는다(오라우팅 방지)', () => {
    setupPushListeners();
    openedHandler?.(message({ groupId: GROUP_ID }));

    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();
  });
});

// ── 서버가 link를 실어 보낸 결과성 푸시(GROMO-1580 ③) ──
// 예전엔 data.link가 있으면 그 자리에서 반환해 표식을 **하나도** 싣지 못했다. 혼합 묶음 결과
// 푸시는 서버가 data.type=BET_RESULT와 link를 함께 싣기 때문에(BetEventNotificationService),
// 그 경로에서만 result=1이 빠져 navigationRef의 멤버십 게이트가 탈퇴자를 잘라 냈다 —
// N53·C8이 보장하려던 도달이 링크 유무에 따라 갈리던 셈이다.
// 고치는 방식은 정해져 있다(결정 N06): **경로는 그대로 두고 표식만 덧붙인다.**
describe('link가 실린 결과성 푸시의 표식(GROMO-1580 ③)', () => {
  const SERVER_LINK = `gromo://group?g=${GROUP_ID}`;

  test('BET_RESULT 혼합 묶음 — 서버 경로를 그대로 두고 result=1만 덧붙인다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'BET_RESULT', groupId: GROUP_ID, link: SERVER_LINK }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`${SERVER_LINK}&result=1`);
  });

  test('BET_VOID_REFUND에 link가 실려 와도 잔액 표식까지 함께 붙는다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'BET_VOID_REFUND', groupId: GROUP_ID, link: SERVER_LINK }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`${SERVER_LINK}&result=1&refund=1`);
  });

  test('쿼리가 없는 링크에는 ?로 잇는다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'BET_RESULT', link: 'gromo://group' }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith('gromo://group?result=1');
  });

  test('이미 표식이 있는 링크에 같은 표식을 두 번 붙이지 않는다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'BET_RESULT', link: `${SERVER_LINK}&result=1` }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`${SERVER_LINK}&result=1`);
  });

  // 표식은 결과성 타입에만 붙는다 — 경로 자체는 어떤 타입에서도 다시 만들지 않는다(N06).
  test('비결과성 타입의 link는 한 글자도 건드리지 않는다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'CHALLENGE_CREATED', link: SERVER_LINK }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(SERVER_LINK);
  });

  test('그룹 밖 딥링크(리그 등)도 경로가 유지된다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'rank_change', link: 'gromo://league' }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith('gromo://league');
  });
});

// ── 포그라운드 정산 결과 수신 → 화면 재조회 신호(GROMO-1580 ④) ──
// 종료 푸시는 정산 **전**에 온다 — 그것을 탭해 들어와 그 방에 머무르는 구간에는 재조회 계기가
// 하나도 없어(useFocusEffect·AppState 복귀·지목 변경 셋 다 발화하지 않는다) 정산이 끝나도
// 사용자가 아무것도 못 보고 대기했다. 신호 모듈은 목이 아니라 **실물**을 구독한다.
describe('포그라운드 정산 결과 수신 신호', () => {
  test('BET_RESULT를 포그라운드에서 받으면 재조회 신호를 쏜다', async () => {
    const seen = jest.fn();
    const off = subscribeBetResultPush(seen);
    setupPushListeners();

    await messageHandler?.(message({ type: 'BET_RESULT', groupId: GROUP_ID }));

    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  test('다른 타입에는 쏘지 않는다 — 불필요한 4콜 재조회를 만들지 않는다', async () => {
    const seen = jest.fn();
    const off = subscribeBetResultPush(seen);
    setupPushListeners();

    await messageHandler?.(message({ type: 'CHALLENGE_WINDOW_END', groupId: GROUP_ID }));
    await messageHandler?.(message({ type: 'CHALLENGE_CREATED', groupId: GROUP_ID }));

    expect(seen).not.toHaveBeenCalled();
    off();
  });

  test('구독을 해제하면 더 이상 받지 않는다', async () => {
    const seen = jest.fn();
    subscribeBetResultPush(seen)();
    setupPushListeners();

    await messageHandler?.(message({ type: 'BET_RESULT', groupId: GROUP_ID }));

    expect(seen).not.toHaveBeenCalled();
  });
});

// 사일런트 data-only 푸시 → 업로드 큐 flush (GROMO-1286 · FR-22). 화면 이동·배너 없음.
// 백그라운드 핸들러는 index.ts 최상위가 registerBackgroundFlushHandler로 등록한다(리뷰 ①).
describe('사일런트 flush(data.silent=flush)', () => {
  const silent = { messageId: 'm-silent', data: { silent: 'flush' } };

  test('백그라운드(index.ts 등록) 수신 — 창 사용분 sync **먼저**, 그다음 집중 큐(리뷰 ④)', async () => {
    registerBackgroundFlushHandler();
    await backgroundHandler?.(silent);

    expect(mockSyncWindow).toHaveBeenCalledWith('me');
    expect(mockFlushFocus).toHaveBeenCalledWith('me');
    // 순서 락 — 사일런트 실행 시간 제한에서 집중 큐(최대 50건 순차)가 먼저 돌면 이 푸시의
    // 존재 이유(FR-22 마지막 창 보고)에 도달하지 못한다.
    expect(mockSyncWindow.mock.invocationCallOrder[0]).toBeLessThan(
      mockFlushFocus.mock.invocationCallOrder[0],
    );
    expect(mockNavigateToDeepLink).not.toHaveBeenCalled(); // 화면 이동 없음(IA §4.2)
  });

  // 백그라운드 커밋 → 잔액 갱신 예약(codex 리뷰 P2). 여기서 커밋된 저장은 서버 잔액을 바꾸고
  // 큐를 비우므로, 사실을 남기지 않으면 포그라운드로 돌아온 PendingFocusUploader가 빈 큐를
  // flush 하며 '커밋 없음'으로 읽어 잔액을 영영 다시 받지 않는다(낡은 잔액 고착).
  // 커밋 확정 시점에 **두 갈래**로 알린다(codex 후속 리뷰 P2): 살아 있는 프로세스는 신호로
  // 즉시(복귀 이벤트와의 순서 의존 제거), 프로세스가 죽는 경우는 영속 마커로.
  test('백그라운드 flush가 커밋했으면 신호를 쏘고 마커도 남긴다', async () => {
    mockFlushFocus.mockResolvedValue(true);
    registerBackgroundFlushHandler();
    await backgroundHandler?.(silent);

    expect(mockRequestCoinRefresh).toHaveBeenCalledTimes(1);
    expect(mockMarkBackgroundCommit).toHaveBeenCalledTimes(1);
  });

  test('커밋이 없었으면 신호도 마커도 없다 — 불필요한 잔액 조회를 만들지 않는다', async () => {
    mockFlushFocus.mockResolvedValue(false);
    registerBackgroundFlushHandler();
    await backgroundHandler?.(silent);

    expect(mockRequestCoinRefresh).not.toHaveBeenCalled();
    expect(mockMarkBackgroundCommit).not.toHaveBeenCalled();
  });

  test('flush가 던지면 신호·마커 모두 없다(커밋 여부를 모른다)', async () => {
    mockFlushFocus.mockRejectedValue(new Error('network'));
    registerBackgroundFlushHandler();
    await backgroundHandler?.(silent);

    expect(mockRequestCoinRefresh).not.toHaveBeenCalled();
    expect(mockMarkBackgroundCommit).not.toHaveBeenCalled();
  });

  test('setupPushListeners는 백그라운드 핸들러를 등록하지 않는다 — index.ts 선등록을 덮으면 안 된다', () => {
    setupPushListeners();
    expect(backgroundHandler).toBeNull();
  });

  test('포그라운드 수신 — flush만 하고 빈 로컬 배너를 만들지 않는다', async () => {
    setupPushListeners();
    await messageHandler?.(silent);

    expect(mockSyncWindow).toHaveBeenCalledWith('me');
    expect(mockFlushFocus).toHaveBeenCalledWith('me');
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  test('silent가 아닌 백그라운드 메시지는 flush를 깨우지 않는다', async () => {
    registerBackgroundFlushHandler();
    await backgroundHandler?.(message({ type: 'BET_RESULT', groupId: GROUP_ID }));

    expect(mockFlushFocus).not.toHaveBeenCalled();
    expect(mockSyncWindow).not.toHaveBeenCalled();
  });

  test('로그아웃(토큰 없음)이면 flush하지 않는다 — 남의 계정 큐를 만들지 않는다', async () => {
    getFreshAccessToken.mockResolvedValue(null);
    registerBackgroundFlushHandler();
    await backgroundHandler?.(silent);

    expect(mockFlushFocus).not.toHaveBeenCalled();
    expect(mockSyncWindow).not.toHaveBeenCalled();
  });

  test('flush 실패는 삼킨다 — 수신 핸들러가 던지면 다음 푸시 처리까지 죽는다', async () => {
    mockFlushFocus.mockRejectedValue(new Error('network'));
    mockSyncWindow.mockRejectedValue(new Error('network'));
    registerBackgroundFlushHandler();
    await expect(backgroundHandler?.(silent)).resolves.toBeUndefined();
  });

  test('이중 실행 멱등 — 두 번 수신해도 각 단계가 그대로 다시 돌 뿐 부작용이 없다', async () => {
    registerBackgroundFlushHandler();
    await backgroundHandler?.(silent);
    await backgroundHandler?.(silent);
    // 창 보고는 upsert+measuredAt 역전 무시(N34), 집중 큐는 flushing 가드 — 호출 자체는 매번 나간다.
    expect(mockSyncWindow).toHaveBeenCalledTimes(2);
    expect(mockFlushFocus).toHaveBeenCalledTimes(2);
  });
});
