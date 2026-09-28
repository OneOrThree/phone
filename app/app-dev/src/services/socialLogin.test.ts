import { Platform } from 'react-native';
import { isSocialLoginCancellation, socialCredential } from './socialLogin';

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
  expect(mockGoogleConfigure).toHaveBeenCalledWith(
    expect.objectContaining({
      webClientId: '899365616896-f9hggskoharr2uogdtvd0d2qvntle8ae.apps.googleusercontent.com',
      iosClientId: '899365616896-4c2hdm77a2d0vt9ntctpcsjj457u5eop.apps.googleusercontent.com',
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
