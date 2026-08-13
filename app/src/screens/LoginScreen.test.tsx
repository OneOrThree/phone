import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import LoginScreen from './LoginScreen';
import { guestLogin } from '@/services/auth';
import type { LoginResult } from '@/types/api';

jest.mock('@/services/auth', () => ({
  kakaoLogin: jest.fn(),
  appleLogin: jest.fn(),
  googleLogin: jest.fn(),
  guestLogin: jest.fn(),
  trackAuthSuccess: jest.fn(),
  getLastAuthProvider: jest.fn(() => Promise.resolve(null)),
  statusCodes: { SIGN_IN_CANCELLED: 'sign_in_cancelled' },
}));

jest.mock('@/services/analyticsEvents', () => ({
  logOnboardingSignupFailed: jest.fn(),
  logOnboardingSignupSelected: jest.fn(),
}));

const mockGuestLogin = guestLogin as jest.MockedFunction<typeof guestLogin>;

const guestResult = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  isNewUser: true,
} as LoginResult;

const originalPlatformOS = Platform.OS;
const originalConfirmDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'confirm');

beforeEach(() => {
  jest.clearAllMocks();
  mockGuestLogin.mockResolvedValue(guestResult);
  Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  if (originalConfirmDescriptor) {
    Object.defineProperty(globalThis, 'confirm', originalConfirmDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'confirm');
  }
});

test('게스트 버튼은 안내창 확인 전까지 계정을 만들지 않고, 확인 뒤에만 로그인한다', async () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onLogin = jest.fn(() => Promise.resolve());
  await render(<LoginScreen onLogin={onLogin} isOnboarding />);
  await act(async () => {});

  await act(async () => {
    fireEvent.press(screen.getByTestId('login.guest'));
  });

  expect(mockGuestLogin).not.toHaveBeenCalled();
  expect(screen.getByText('게스트 로그인')).toBeOnTheScreen();
  expect(screen.queryByTestId('login.guestNotice')).not.toBeOnTheScreen();
  expect(alertSpy).toHaveBeenCalledWith(
    '게스트 로그인 안내',
    expect.stringContaining('기록을 되찾을 수 없어요'),
    expect.any(Array),
  );

  const buttons = alertSpy.mock.calls[0]?.[2];
  const confirm = buttons?.find((button) => button.text === '확인');
  expect(confirm).toBeDefined();

  await act(async () => {
    confirm?.onPress?.();
  });

  expect(mockGuestLogin).toHaveBeenCalledTimes(1);
  expect(onLogin).toHaveBeenCalledWith(guestResult);
});

test('웹에서는 브라우저 확인창 승인 뒤 게스트 로그인을 실행한다', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const confirmSpy = jest.fn(() => true);
  Object.defineProperty(globalThis, 'confirm', { value: confirmSpy, configurable: true });
  const onLogin = jest.fn(() => Promise.resolve());
  await render(<LoginScreen onLogin={onLogin} isOnboarding />);
  await act(async () => {});

  await act(async () => {
    fireEvent.press(screen.getByTestId('login.guest'));
  });

  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('기록을 되찾을 수 없어요'));
  expect(alertSpy).not.toHaveBeenCalledWith(
    '게스트 로그인 안내',
    expect.anything(),
    expect.anything(),
  );
  expect(mockGuestLogin).toHaveBeenCalledTimes(1);
  expect(onLogin).toHaveBeenCalledWith(guestResult);
});
