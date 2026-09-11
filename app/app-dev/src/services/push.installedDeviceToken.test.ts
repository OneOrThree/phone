// 구 앱에서 업그레이드한 기기의 «잔여 FCM 토큰» 해석기 배선 (GROMO-1659).
//
// 여기서 잠그는 것:
//  1) push 모듈이 **로드되는 즉시** 해석기를 배선한다 — 권한 검사(hasPermission)나 첫 등록
//     (registerPushToken)이 돌기 «전»이다. 첫 등록이 권한 거부·getToken 실패로 건너뛰어지는
//     것이 바로 이 해석기가 필요한 상황이라, 등록 경로 안에서 배선하면 영영 배선되지 않는다.
//  2) 해석기는 등록이 쓰는 것과 같은 getToken을 그대로 쓴다 — 값을 지어내지 않는다.
//  3) getToken이 실패하면 null이다. 넓은 삭제로 승격하지 않는다(호출부 deletionTarget ③).
//  4) E2E 빌드는 registerPushToken과 같은 이유로 FCM에 닿지 않는다(GROMO-947).
//
// 웹 번들(push.web.ts)에는 이 배선이 «없다» — FCM 자체가 없어 해석기는 미등록으로 남고,
// 호출부는 해석기가 없으면 종전대로 삭제 대상을 만들지 않는다.
import { setInstalledDeviceTokenResolver } from '@/services/notificationCommands';

jest.mock('@/services/notificationCommands', () => ({
  queueDeviceRegistration: jest.fn(async () => {}),
  setInstalledDeviceTokenResolver: jest.fn(),
}));
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
jest.mock('@/services/screentimeSync', () => ({ syncWindowUsage: jest.fn(async () => {}) }));
jest.mock('@/store/coinRefreshSignal', () => ({ requestCoinRefresh: jest.fn() }));
jest.mock('@/services/analyticsEvents', () => ({
  logNotificationOpened: jest.fn(),
  logNotificationPermissionResult: jest.fn(),
  logPushOpened: jest.fn(),
  logPokeReceived: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const mockGetToken = jest.fn(async () => 'fcm-installed');
const mockHasPermission = jest.fn(async () => 1);
jest.mock('@react-native-firebase/messaging', () => {
  const instance = {
    hasPermission: () => mockHasPermission(),
    requestPermission: jest.fn(async () => 1),
    getToken: () => mockGetToken(),
    onTokenRefresh: jest.fn(() => jest.fn()),
    onMessage: jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn(() => jest.fn()),
    setBackgroundMessageHandler: jest.fn(),
    getInitialNotification: jest.fn(async () => null),
  };
  const messaging = () => instance;
  messaging.AuthorizationStatus = { NOT_DETERMINED: -1, AUTHORIZED: 1, PROVISIONAL: 2, DENIED: 0 };
  return { __esModule: true, default: messaging };
});

const mockSetResolver = setInstalledDeviceTokenResolver as jest.MockedFunction<
  typeof setInstalledDeviceTokenResolver
>;

// import 자체가 검증 대상이다 — 모듈 로드의 부수효과로 배선되는지를 본다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerPushToken } = require('./push') as typeof import('./push');

function resolver(): () => Promise<string | null> {
  const registered = mockSetResolver.mock.calls[0][0];
  if (!registered) throw new Error('해석기가 배선되지 않았습니다.');
  return registered;
}

test('권한 검사·첫 등록보다 먼저, 모듈 로드 시점에 해석기를 배선한다', () => {
  expect(mockSetResolver).toHaveBeenCalledTimes(1);
  expect(typeof mockSetResolver.mock.calls[0][0]).toBe('function');
  // 배선은 등록 경로 «밖»이다 — 권한을 묻지도, 토큰을 받지도 않은 채 이미 붙어 있다.
  expect(mockHasPermission).not.toHaveBeenCalled();
  expect(mockGetToken).not.toHaveBeenCalled();
});

test('해석기는 등록과 같은 getToken 값을 그대로 돌려준다', async () => {
  mockGetToken.mockResolvedValueOnce('fcm-legacy');
  await expect(resolver()()).resolves.toBe('fcm-legacy');
  expect(mockGetToken).toHaveBeenCalledTimes(1);
});

test('getToken 실패는 null이다 — 권한 거부로 첫 등록이 건너뛰어진 뒤에도 그렇다', async () => {
  mockGetToken.mockRejectedValueOnce(new Error('permission denied'));
  await expect(resolver()()).resolves.toBeNull();

  // 첫 등록이 실제로 건너뛰어지는 경로(권한 거부)와 같은 상태에서 다시 물어도 값만 없을 뿐,
  // 예외로 로그아웃 흐름을 깨지 않는다.
  mockHasPermission.mockResolvedValueOnce(0);
  await expect(registerPushToken()).resolves.toBeNull();
  mockGetToken.mockRejectedValueOnce(new Error('permission denied'));
  await expect(resolver()()).resolves.toBeNull();
});

test('E2E 빌드는 FCM에 닿지 않는다', async () => {
  const previous = process.env.EXPO_PUBLIC_E2E;
  process.env.EXPO_PUBLIC_E2E = '1';
  try {
    mockGetToken.mockClear();
    await expect(resolver()()).resolves.toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  } finally {
    process.env.EXPO_PUBLIC_E2E = previous;
  }
});
