import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import { ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  cancelBuildingTransition,
  createBuildingTransitionController,
} from '@/services/buildingTransition';

let captured: any;
const mockApiLogin = jest.fn();
const mockSocialCredential = jest.fn();
const mockAdoptSignedInAccount = jest.fn(async (..._args: unknown[]) => {});

jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    captured = e;
    return null;
  },
}));

jest.mock('@/services/api/auth', () => ({
  checkSession: async () => ({ status: 'offline' }),
  guestLogin: jest.fn(),
  login: (...args: unknown[]) => mockApiLogin(...args),
  logout: async () => {},
}));

jest.mock('@/services/socialLogin', () => ({
  socialCredential: (...args: unknown[]) => mockSocialCredential(...args),
  isSocialLoginCancellation: (error: unknown) =>
    !!error && typeof error === 'object' && 'code' in error && error.code === 'SIGN_IN_CANCELLED',
}));

jest.mock('@/services/memberConversion', () => {
  const actual = jest.requireActual('@/services/memberConversion');
  return {
    ...actual,
    adoptSignedInAccount: (...args: unknown[]) => mockAdoptSignedInAccount(...args),
  };
});

jest.mock('@/services/islandBoot', () => ({
  decideBootRoute: async () => 'login',
}));

jest.mock('@/services/api/session', () => {
  const actual = jest.requireActual('@/services/api/session');
  return { ...actual, restoreSession: async () => null };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(async () => {
  captured = undefined;
  jest.clearAllMocks();
  await clearSession();
});

test('소셜 로그인은 SDK 자격을 서버에 보내고 취소는 오류로 표시하지 않는다', async () => {
  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin.mockResolvedValueOnce({
    accessToken: 'AT',
    refreshToken: 'RT',
    userId: 'u1',
    onboardingComplete: true,
  });
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));

  await act(async () => captured.setTerms(true));
  await act(async () => captured.startSocial('google'));
  assert.equal(mockSocialCredential.mock.calls[0][0], 'google');
  assert.equal(mockApiLogin.mock.calls[0][0], 'google');
  assert.equal(mockApiLogin.mock.calls[0][1], 'google-id-token');
  assert.equal(mockApiLogin.mock.calls[0][2], '2026-09');
  assert.equal(mockAdoptSignedInAccount.mock.calls.length, 1);
  await waitFor(() => assert.equal(captured.socialBusy, null));
  assert.equal(captured.socialError, '');

  mockSocialCredential.mockRejectedValueOnce({ code: 'SIGN_IN_CANCELLED' });
  await act(async () => captured.startSocial('google'));
  await waitFor(() => assert.equal(captured.socialBusy, null));
  assert.equal(captured.socialError, '');
});

test('소셜 로그인 pending 중에는 중복 요청을 막고 오류 메시지를 구분한다', async () => {
  let resolveCredential: (credential: string) => void = () => {};
  mockSocialCredential.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        resolveCredential = resolve;
      }),
  );
  mockApiLogin.mockResolvedValueOnce({
    accessToken: 'AT',
    refreshToken: 'RT',
    userId: 'u1',
    onboardingComplete: true,
  });
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await act(async () => captured.setTerms(true));

  let pending!: Promise<void>;
  await act(async () => {
    pending = captured.startSocial('google');
    await Promise.resolve();
  });
  await waitFor(() => assert.equal(captured.socialBusy, 'google'));
  await act(async () => captured.startSocial('kakao'));
  assert.equal(mockSocialCredential.mock.calls.length, 1);
  resolveCredential('google-id-token');
  await act(async () => pending);

  mockSocialCredential.mockRejectedValueOnce(new ApiError('GOOGLE_TOKEN', '토큰 오류', 422));
  await act(async () => captured.startSocial('google'));
  await waitFor(() => assert.equal(captured.socialError, '토큰 오류'));

  mockSocialCredential.mockRejectedValueOnce(new Error('network'));
  await act(async () => captured.startSocial('google'));
  await waitFor(() =>
    assert.equal(captured.socialError, '로그인을 완료하지 못했어요. 다시 시도해 주세요.'),
  );
});

test('소셜 로그인 retryable 응답 재시도는 자격과 attemptId를 재사용한다', async () => {
  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin
    .mockRejectedValueOnce(new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }))
    .mockResolvedValueOnce({
      accessToken: 'AT',
      refreshToken: 'RT',
      userId: 'u1',
      onboardingComplete: true,
    });
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await act(async () => captured.setTerms(true));

  await act(async () => captured.startSocial('google'));
  await act(async () => captured.startSocial('google'));

  assert.equal(mockSocialCredential.mock.calls.length, 1);
  assert.equal(mockApiLogin.mock.calls.length, 2);
  assert.equal(mockApiLogin.mock.calls[0][1], mockApiLogin.mock.calls[1][1]);
  assert.equal(mockApiLogin.mock.calls[0][3].attemptId, mockApiLogin.mock.calls[1][3].attemptId);
  assert.match(mockApiLogin.mock.calls[0][3].attemptId, /^[0-9a-f-]{36}$/i);
});

test('회원 전환은 소셜 성공 시 닫히고 사용자 취소 시 오류 없이 유지된다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin.mockResolvedValueOnce({
    accessToken: 'AT',
    refreshToken: 'RT',
    userId: 'guest',
    onboardingComplete: true,
  });
  let screen: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    screen = await render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.equal(typeof captured.conversion?.offer, 'function'));

  await act(async () => {
    captured.conversion.offer(
      new ApiError('SOCIAL_LOGIN_REQUIRED', '소셜 로그인이 필요합니다.', 403),
    );
  });
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.equal(screen!.queryByText('소셜 계정으로 계속하기'), null));

  mockSocialCredential.mockRejectedValueOnce({ code: 'SIGN_IN_CANCELLED' });
  await act(async () => {
    captured.conversion.offer(
      new ApiError('SOCIAL_LOGIN_REQUIRED', '소셜 로그인이 필요합니다.', 403),
    );
  });
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.ok(screen!.getByText('소셜 계정으로 계속하기')));
  assert.equal(screen!.queryByText('문제가 생겼어요. 다시 시도해 주세요.'), null);

  mockSocialCredential.mockRejectedValueOnce(
    new ApiError('GOOGLE_TOKEN', '회원 전환 토큰 오류', 422),
  );
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.ok(screen!.getByText('회원 전환 토큰 오류')));

  mockSocialCredential.mockRejectedValueOnce(new Error('network'));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.ok(screen!.getByText('문제가 생겼어요. 다시 시도해 주세요.')));
});

test('회원 전환 retryable 응답 재시도는 같은 소셜 자격을 재사용한다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin
    .mockRejectedValueOnce(new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }))
    .mockResolvedValueOnce({
      accessToken: 'AT',
      refreshToken: 'RT',
      userId: 'guest',
      onboardingComplete: true,
    });
  let screen: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    screen = await render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.equal(typeof captured.conversion?.offer, 'function'));
  await act(async () => {
    captured.conversion.offer(
      new ApiError('SOCIAL_LOGIN_REQUIRED', '소셜 로그인이 필요합니다.', 403),
    );
  });

  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.ok(screen!.getByText('처리 중')));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));

  assert.equal(mockSocialCredential.mock.calls.length, 1);
  assert.equal(mockApiLogin.mock.calls.length, 2);
  assert.equal(mockApiLogin.mock.calls[0][1], mockApiLogin.mock.calls[1][1]);
  assert.equal(mockApiLogin.mock.calls[0][3].attemptId, mockApiLogin.mock.calls[1][3].attemptId);
});

test('CurrentScreens에는 실제 공개 세션이 있을 때만 서버 섬·집중 명령을 주입한다', async () => {
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  assert.equal(captured.islands, undefined);
  assert.equal(captured.focus, undefined);

  await act(async () => {
    await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  });
  await waitFor(() => assert.equal(typeof captured.islands?.create, 'function'));
  assert.equal(typeof captured.focus?.start, 'function');
  assert.equal(typeof captured.focus?.pause, 'function');
  assert.equal(typeof captured.focus?.resume, 'function');
  assert.equal(typeof captured.focus?.finish, 'function');

  await act(async () => {
    await clearSession();
  });
  await waitFor(() => assert.equal(captured.islands, undefined));
  assert.equal(captured.focus, undefined);
});

test('휴식 진입 전환을 취소하면 일시정지한 집중 세션을 다시 시작한다', async () => {
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));

  await act(async () => {
    captured.dispatch({
      type: 'SESSION_SYNC',
      session: {
        id: 'local-session',
        islandId: 'cloud',
        subject: '집중',
        startedAt: Date.now() - 60_000,
        restStartedAt: Date.now(),
        seconds: 60,
        status: 'paused',
        intervals: [],
      },
    });
    captured.go('focus');
  });
  await waitFor(() => assert.equal(captured.route, 'focus'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await act(async () => captured.go('rest'));

  await act(async () => {
    assert.equal(cancelBuildingTransition(), true);
  });
  await waitFor(() => assert.equal(captured.state.session?.status, 'active'));
  assert.equal(captured.route, 'focus');
});

test('서버 집중 재개가 실패하면 일시정지 세션을 휴식 경로로 돌려보낸다', async () => {
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await act(async () => {
    await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  });
  await waitFor(() => assert.equal(typeof captured.focus?.resume, 'function'));

  const resume = jest.fn().mockRejectedValue(new Error('network unavailable'));
  captured.focus.resume = resume;
  await act(async () => {
    captured.dispatch({
      type: 'SESSION_SYNC',
      session: {
        id: 'server-session',
        islandId: 'cloud',
        subject: '집중',
        startedAt: Date.now() - 60_000,
        restStartedAt: Date.now(),
        seconds: 60,
        status: 'paused',
        intervals: [],
        version: 2,
      },
    });
    captured.go('focus');
  });
  await waitFor(() => assert.equal(captured.route, 'focus'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  await act(async () => captured.go('rest'));
  await act(async () => {
    assert.equal(cancelBuildingTransition(), true);
  });

  await waitFor(() => assert.equal(resume.mock.calls.length, 1));
  await waitFor(() => assert.equal(captured.route, 'rest'));
  assert.equal(captured.state.session?.status, 'paused');
});

test('WorldMap의 진입 전환 중에는 앱 콘텐츠를 접근성 트리에서 숨긴다', async () => {
  let app!: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    app = await render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() =>
    assert.equal(
      app.getByTestId('app-content', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
      false,
    ),
  );

  const controller = createBuildingTransitionController();
  try {
    await act(async () => {
      controller.start('board', 'enter', false, jest.fn(), 10_000);
    });
    assert.equal(
      app.getByTestId('app-content', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
      true,
    );

    await act(async () => {
      controller.cancel();
    });
    await waitFor(() =>
      assert.equal(
        app.getByTestId('app-content', { includeHiddenElements: true }).props
          .accessibilityElementsHidden,
        false,
      ),
    );
  } finally {
    await act(async () => {
      controller.cancel();
      controller.dispose();
    });
  }
});
