import { Platform } from 'react-native';
import googleClientIds from '@/config/googleClientIds.json';
import { appleAuthorizationCode, isSocialLoginCancellation, socialCredential } from './socialLogin';

const mockKakaoLogin = jest.fn();
const mockAppleSignIn = jest.fn();
const mockGoogleConfigure = jest.fn();
const mockGoogleSignIn = jest.fn();
const mockLineSetup = jest.fn();
const mockLineLogin = jest.fn();

jest.mock('@react-native-kakao/user', () => ({
  login: (...args: unknown[]) => mockKakaoLogin(...args),
}));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: (...args: unknown[]) => mockAppleSignIn(...args),
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...args: unknown[]) => mockGoogleConfigure(...args),
    signIn: (...args: unknown[]) => mockGoogleSignIn(...args),
  },
  isSuccessResponse: (response: { type: string }) => response.type === 'success',
  statusCodes: { SIGN_IN_CANCELLED: '12501' },
}));
jest.mock('@xmartlabs/react-native-line', () => ({
  __esModule: true,
  default: {
    setup: (...args: unknown[]) => mockLineSetup(...args),
    login: (...args: unknown[]) => mockLineLogin(...args),
  },
  Scope: { Profile: 'profile' },
}));

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
});

const loaders = {
  kakao: async () => ({ login: mockKakaoLogin }),
  apple: async () => ({
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    signInAsync: mockAppleSignIn,
  }),
  google: async () => ({
    GoogleSignin: { configure: mockGoogleConfigure, signIn: mockGoogleSignIn },
    isSuccessResponse: (response: { type: string }) => response.type === 'success',
  }),
  line: async () => ({
    default: { setup: mockLineSetup, login: mockLineLogin },
    Scope: { Profile: 'profile' },
  }),
} as any;

test('각 제공자의 서버 자격 토큰을 반환한다', async () => {
  mockKakaoLogin.mockResolvedValue({ accessToken: 'kakao-access' });
  mockAppleSignIn.mockResolvedValue({ identityToken: 'apple-id-token' });
  mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
  mockLineSetup.mockResolvedValue(undefined);
  mockLineLogin.mockResolvedValue({ accessToken: { accessToken: 'line-access' } });

  await expect(socialCredential('kakao', loaders)).resolves.toBe('kakao-access');
  await expect(socialCredential('apple', loaders)).resolves.toBe('apple-id-token');
  await expect(socialCredential('google', loaders)).resolves.toBe('google-id-token');
  await expect(socialCredential('line', loaders)).resolves.toBe('line-access');
  await expect(socialCredential('line', loaders)).resolves.toBe('line-access');
  // 1.x 와 같이 iOS 도 webClientId 를 넘겨 ID 토큰 aud 가 웹 클라이언트로 통일된다. jest 는 __DEV__ 라 dev 행이다.
  expect(mockGoogleConfigure).toHaveBeenCalledWith(
    expect.objectContaining({
      webClientId: googleClientIds.dev.web,
      iosClientId: googleClientIds.dev.ios,
    }),
  );
  expect(mockLineSetup).toHaveBeenCalledWith({ channelId: '2011754820' });
  expect(mockLineSetup).toHaveBeenCalledTimes(1);
  expect(mockLineLogin).toHaveBeenCalledTimes(2);
});

test('Google 취소 응답을 공통 취소 코드로 변환한다', async () => {
  mockGoogleSignIn.mockResolvedValue({ type: 'cancelled' });

  await expect(socialCredential('google', loaders)).rejects.toMatchObject({
    code: 'SIGN_IN_CANCELLED',
  });
});

test('웹과 Android의 Apple 로그인은 명시적으로 거절한다', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  await expect(socialCredential('google', loaders)).rejects.toMatchObject({
    code: 'CLIENT_PROVIDER_UNAVAILABLE',
  });

  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  await expect(socialCredential('apple', loaders)).rejects.toMatchObject({
    code: 'CLIENT_PROVIDER_UNAVAILABLE',
  });
});

test('Apple과 Google 토큰이 비어 있으면 명시적 오류를 반환한다', async () => {
  mockAppleSignIn.mockResolvedValue({ identityToken: null });
  mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: null } });

  await expect(socialCredential('apple', loaders)).rejects.toMatchObject({
    code: 'CLIENT_PROVIDER_UNAVAILABLE',
  });
  await expect(socialCredential('google', loaders)).rejects.toMatchObject({
    code: 'CLIENT_PROVIDER_UNAVAILABLE',
  });
});

test('탈퇴용 Apple 코드는 범위 없이 재인증해 authorizationCode 를 돌려준다', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  mockAppleSignIn.mockResolvedValue({ authorizationCode: 'auth-code', identityToken: 'x' });
  await expect(appleAuthorizationCode(loaders)).resolves.toBe('auth-code');
  expect(mockAppleSignIn).toHaveBeenLastCalledWith({ requestedScopes: [] });

  mockAppleSignIn.mockResolvedValue({ authorizationCode: null });
  await expect(appleAuthorizationCode(loaders)).rejects.toMatchObject({
    code: 'CLIENT_PROVIDER_UNAVAILABLE',
  });

  // 시트 취소는 원래 오류 그대로 던져져 호출부가 취소로 판별한다.
  mockAppleSignIn.mockRejectedValue(
    Object.assign(new Error('c'), { code: 'ERR_REQUEST_CANCELED' }),
  );
  const canceled = await appleAuthorizationCode(loaders).catch((error: unknown) => error);
  expect(isSocialLoginCancellation(canceled)).toBe(true);
});

test.each([
  'ERR_REQUEST_CANCELED',
  'ERR_CANCELED',
  'SIGN_IN_CANCELLED',
  'E_CANCELLED_OPERATION',
  'CANCELLED',
  'LOGIN_CANCELLED',
  '3003',
])('%s 제공자 취소는 사용자 오류로 표시하지 않는다', (code) => {
  expect(isSocialLoginCancellation({ code })).toBe(true);
});

test.each([null, new Error('network'), { code: 'NETWORK_ERROR' }])(
  '취소가 아닌 실패는 오류로 처리한다',
  (error) => {
    expect(isSocialLoginCancellation(error)).toBe(false);
  },
);

test('Android Google 설정은 ID 토큰 발급에 필요한 webClientId 를 넘긴다', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
  let isolated!: typeof socialCredential;
  jest.isolateModules(() => {
    isolated = require('./socialLogin').socialCredential;
  });

  await expect(isolated('google', loaders)).resolves.toBe('google-id-token');
  expect(mockGoogleConfigure).toHaveBeenCalledWith(
    expect.objectContaining({ webClientId: googleClientIds.dev.web }),
  );
});

// GROMO-2226 — 빌드 환경별 클라이언트 id 행 선택. JSON 을 가짜 값으로 바꿔 실제 파일(prod 칸이 채워지는 때)과 무관하게 본다.
describe('구글 클라이언트 id 행 선택', () => {
  const DEV = {
    ios: 'dev-ios.apps.googleusercontent.com',
    web: 'dev-web.apps.googleusercontent.com',
  };
  const PROD = {
    ios: 'prod-ios.apps.googleusercontent.com',
    web: 'prod-web.apps.googleusercontent.com',
  };
  const EMPTY = { ios: '', web: '' };
  const originalDev = __DEV__;
  const originalEnv = process.env.EXPO_PUBLIC_ENV;

  afterEach(() => {
    Object.assign(globalThis, { __DEV__: originalDev });
    if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_ENV;
    else process.env.EXPO_PUBLIC_ENV = originalEnv;
    jest.dontMock('@/config/googleClientIds.json');
  });

  /** 릴리스 번들처럼(__DEV__=false) 주어진 EXPO_PUBLIC_ENV·JSON 으로 socialLogin 을 새로 불러온다. */
  function loadRelease(env: string | undefined, prod: typeof PROD) {
    Object.assign(globalThis, { __DEV__: false });
    if (env === undefined) delete process.env.EXPO_PUBLIC_ENV;
    else process.env.EXPO_PUBLIC_ENV = env;
    jest.doMock('@/config/googleClientIds.json', () => ({ dev: DEV, prod }));
    let isolated!: typeof socialCredential;
    jest.isolateModules(() => {
      isolated = require('./socialLogin').socialCredential;
    });
    return isolated;
  }

  test('운영 번들(EXPO_PUBLIC_ENV=prod)은 prod 행의 id 로 설정한다', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
    await expect(loadRelease('prod', PROD)('google', loaders)).resolves.toBe('google-id-token');
    expect(mockGoogleConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ webClientId: PROD.web, iosClientId: PROD.ios }),
    );
  });

  test('릴리스 dev 빌드(EXPO_PUBLIC_ENV=dev)는 dev 행의 id 로 설정한다', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
    await expect(loadRelease('dev', PROD)('google', loaders)).resolves.toBe('google-id-token');
    expect(mockGoogleConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ webClientId: DEV.web, iosClientId: DEV.ios }),
    );
  });

  test.each([
    ['prod', 'prod'],
    ['빈 문자열', ''],
    ['미설정', undefined],
    ['dev 가 아닌 값', 'staging'],
  ])(
    '운영 id 가 비어 있으면 EXPO_PUBLIC_ENV=%s 여도 dev id 로 돌아가지 않고 거절한다',
    async (_, env) => {
      mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
      await expect(loadRelease(env, EMPTY)('google', loaders)).rejects.toMatchObject({
        code: 'CLIENT_PROVIDER_UNAVAILABLE',
      });
      expect(mockGoogleConfigure).not.toHaveBeenCalled();
      expect(mockGoogleSignIn).not.toHaveBeenCalled();
    },
  );

  test('prod 행의 한쪽만 비어 있어도 거절한다', async () => {
    await expect(
      loadRelease('prod', { ios: PROD.ios, web: '' })('google', loaders),
    ).rejects.toMatchObject({ code: 'CLIENT_PROVIDER_UNAVAILABLE' });
    expect(mockGoogleConfigure).not.toHaveBeenCalled();
  });
});
