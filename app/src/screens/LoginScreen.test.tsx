import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
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

beforeEach(() => {
  jest.clearAllMocks();
  mockGuestLogin.mockResolvedValue(guestResult);
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
