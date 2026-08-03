// 푸시 딥링크 배선 테스트 — 계약 §2(딥링크 페이로드) · GROMO-1088.
//
// 여기서 잠그는 것: 푸시를 탭했을 때 **세 경로 모두** 서버가 실어 보낸 data.link를 그대로
// navigateToDeepLink로 흘린다는 사실이다. 링크 문법(challenge 파라미터)이 서버·앱 계약이라
// 한 경로라도 link를 재조립하거나 잘라 쓰면 결과 모달이 조용히 열리지 않는다.
//   1) 백그라운드 배너 탭  — messaging().onNotificationOpenedApp
//   2) 포그라운드 로컬 알림 탭 — Notifications.addNotificationResponseReceivedListener
//   3) 콜드스타트 — messaging().getInitialNotification
// 레거시 폴백(link 없이 type=CHALLENGE_WINDOW_END + groupId)은 구 바이너리 호환이라 유지한다.
import { handleInitialNotification, setupPushListeners } from './push';
import { navigateToDeepLink } from '@/navigation/navigationRef';

jest.mock('@/navigation/navigationRef', () => ({ navigateToDeepLink: jest.fn() }));
jest.mock('@/services/api', () => ({ api: { put: jest.fn() } }));
jest.mock('@/services/notificationInbox', () => ({ addToInbox: jest.fn() }));
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
const mockGetInitialNotification = jest.fn(async () => null as unknown);
jest.mock('@react-native-firebase/messaging', () => {
  const instance = {
    onTokenRefresh: jest.fn(() => jest.fn()),
    onMessage: jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn((cb: (msg: unknown) => void) => {
      openedHandler = cb;
      return jest.fn();
    }),
    getInitialNotification: () => mockGetInitialNotification(),
  };
  const messaging = () => instance;
  messaging.AuthorizationStatus = { NOT_DETERMINED: -1, AUTHORIZED: 1, PROVISIONAL: 2 };
  return { __esModule: true, default: messaging };
});

const mockNavigateToDeepLink = navigateToDeepLink as jest.MockedFunction<typeof navigateToDeepLink>;

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
  openedHandler = null;
  responseHandler = null;
});

describe('챌린지 종료 푸시 딥링크(3경로)', () => {
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

describe('레거시 폴백(구 바이너리 호환 — 제거하지 않는다)', () => {
  test('link 없이 type=CHALLENGE_WINDOW_END + groupId면 그룹 딥링크를 합성한다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'CHALLENGE_WINDOW_END', groupId: GROUP_ID }));

    expect(mockNavigateToDeepLink).toHaveBeenCalledWith(`gromo://group?g=${GROUP_ID}`);
  });

  test('link도 폴백 조건도 없으면 이동하지 않는다', () => {
    setupPushListeners();
    openedHandler?.(message({ type: 'CHALLENGE_ENDED', groupId: GROUP_ID }));

    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();
  });
});
