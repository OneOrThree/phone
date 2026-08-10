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
import { flushPendingFocusUploads } from '@/screens/focus/pendingFocusUploads';
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
}));
jest.mock('@/services/screentimeSync', () => ({
  syncWindowUsage: jest.fn(async () => {}),
}));
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
    notification: { title: '챌린지가 끝났어요', body: '결과를 확인해보세요' },
    data,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getFreshAccessToken.mockResolvedValue('token');
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

  test('CHALLENGE_SESSION_END + challengeId → 그룹방 + 결과 모달(challenge) + result 표식', () => {
    setupPushListeners();
    openedHandler?.(
      message({ type: 'CHALLENGE_SESSION_END', groupId: GROUP_ID, challengeId: CHALLENGE_ID }),
    );

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`${END_LINK}&result=1`);
  });

  test('CHALLENGE_SESSION_END인데 challengeId가 없으면(묶음) 그룹방까지만(result 표식은 유지)', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'CHALLENGE_SESSION_END', groupId: GROUP_ID }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`gromo://group?g=${GROUP_ID}&result=1`);
  });

  // 삭제 환불은 이 푸시가 알리는 사건이다 — 결과 모달까지 열면 같은 사건 이중 통지(N48).
  // challengeId가 실려 와도 challenge 파라미터를 합성하지 않는다.
  test('BET_VOID_REFUND → 그룹방까지만, 결과 모달을 지목하지 않는다(N48)', () => {
    setupPushListeners();
    openedHandler?.(
      message({
        type: 'BET_VOID_REFUND',
        groupId: GROUP_ID,
        challengeId: CHALLENGE_ID,
        voidReason: 'CHALLENGE_DELETED',
      }),
    );

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`gromo://group?g=${GROUP_ID}&result=1`);
  });

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

describe('레거시 폴백(구 바이너리 호환 — 제거하지 않는다)', () => {
  test('link 없이 type=CHALLENGE_WINDOW_END + groupId면 그룹 딥링크를 합성한다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'CHALLENGE_WINDOW_END', groupId: GROUP_ID }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`gromo://group?g=${GROUP_ID}`);
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
