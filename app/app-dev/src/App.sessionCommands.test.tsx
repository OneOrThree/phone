import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '@/App';
import type { Account } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import {
  clearSession,
  getLastSessionUserId,
  rememberLocalDataOwner,
  saveSession,
  sessionGeneration,
} from '@/services/api/session';
import {
  cancelBuildingTransition,
  createBuildingTransitionController,
} from '@/services/buildingTransition';
import { initialState } from '@/services/model';

let captured: any;
const mockApiLogin = jest.fn();
const mockSocialCredential = jest.fn();
const mockGuestLogin = jest.fn();
const mockCheckSession = jest.fn();
const mockRestoreSession = jest.fn();
const mockDecideBootRoute = jest.fn();
const mockSyncIslands = jest.fn();
const mockRecoverFocus = jest.fn();
const mockPrepareLogout = jest.fn();
const mockLogout = jest.fn(async (_prepared?: Promise<void>) => {});
let mockEmitAppLink: ((url: string) => void) | undefined;
let mockAppDispatch: ((action: any) => void) | undefined;
const mockAdoptSignedInAccount = jest.fn(
  async (result: { userId: string }, ..._args: any[]): Promise<Account> => ({
    id: result.userId,
    name: null,
    catColor: null,
    mainIslandId: null,
    linkedProviders: [],
    onboardingComplete: true,
  }),
);

jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    captured = e;
    return null;
  },
}));

jest.mock('@/services/api/auth', () => ({
  checkSession: (...args: unknown[]) => mockCheckSession(...args),
  guestLogin: (...args: unknown[]) => mockGuestLogin(...args),
  login: (...args: unknown[]) => mockApiLogin(...args),
  logout: (prepared?: Promise<void>) => mockLogout(prepared),
  prepareLogout: () => mockPrepareLogout(),
}));

jest.mock('@/services/appDeepLink', () => {
  const actual = jest.requireActual('@/services/appDeepLink');
  return {
    ...actual,
    subscribeToAppLinks: (onUrl: (url: string) => void) => {
      mockEmitAppLink = onUrl;
      return () => {
        mockEmitAppLink = undefined;
      };
    },
  };
});

jest.mock('@/services/socialLogin', () => ({
  socialCredential: (...args: unknown[]) => mockSocialCredential(...args),
  isSocialLoginCancellation: (error: unknown) =>
    !!error && typeof error === 'object' && 'code' in error && error.code === 'SIGN_IN_CANCELLED',
}));

jest.mock('@/services/memberConversion', () => {
  const actual = jest.requireActual('@/services/memberConversion');
  return {
    ...actual,
    adoptSignedInAccount: (result: { userId: string }, ..._args: unknown[]) =>
      mockAdoptSignedInAccount(result, ..._args),
  };
});

jest.mock('@/services/termsVersion', () => ({
  get TERMS_VERSION() {
    return process.env.EXPO_PUBLIC_TERMS_VERSION?.trim() ?? '';
  },
}));

jest.mock('@/services/api/session', () => {
  const actual = jest.requireActual('@/services/api/session');
  return {
    ...actual,
    restoreSession: (...args: unknown[]) => mockRestoreSession(...args),
  };
});

jest.mock('@/services/islandBoot', () => ({
  decideBootRoute: (...args: unknown[]) => mockDecideBootRoute(...args),
}));

jest.mock('@/services/islandCommands', () => {
  const actual = jest.requireActual('@/services/islandCommands');
  return {
    ...actual,
    createIslandCommands: (...args: any[]) => {
      mockAppDispatch = args[0].dispatch;
      const created = actual.createIslandCommands(...args);
      return {
        ...created,
        syncIslands: (...syncArgs: unknown[]) => mockSyncIslands(...syncArgs),
        commands: {
          ...created.commands,
          sync: (...syncArgs: unknown[]) => mockSyncIslands(...syncArgs),
        },
      };
    },
  };
});

jest.mock('@/services/sessionCommands', () => {
  const actual = jest.requireActual('@/services/sessionCommands');
  return {
    ...actual,
    createSessionCommands: (...args: unknown[]) => {
      const result = actual.createSessionCommands(...args);
      return {
        ...result,
        commands: {
          ...result.commands,
          recover: (...recoverArgs: unknown[]) => mockRecoverFocus(...recoverArgs),
        },
      };
    },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(async () => {
  process.env.EXPO_PUBLIC_TERMS_VERSION = 'test-terms-v1';
  captured = undefined;
  jest.clearAllMocks();
  // clearAllMocks는 *Once 큐를 비우지 않는다. 소비되지 않은 응답이 다음 테스트로 새지 않게 비운다.
  mockApiLogin.mockReset();
  mockSocialCredential.mockReset();
  mockGuestLogin.mockReset();
  mockPrepareLogout.mockReset();
  mockPrepareLogout.mockResolvedValue(undefined);
  mockCheckSession.mockResolvedValue({ status: 'offline' });
  mockRestoreSession.mockResolvedValue(null);
  mockDecideBootRoute.mockResolvedValue('login');
  mockSyncIslands.mockReset();
  mockSyncIslands.mockResolvedValue({ currentIslandId: null, items: [] });
  mockRecoverFocus.mockResolvedValue(null);
  mockAppDispatch = undefined;
  await clearSession();
  // 앞 테스트의 앱 저장본(섬·온보딩 상태)이 다음 테스트의 부팅 LOAD로 새지 않게 비운다.
  // removeItem 호출 수를 세는 테스트가 있어 multiRemove로 지운다.
  await AsyncStorage.multiRemove(['gromo-r61-user-v2']);
});

test('owner와 복구 세션이 다르면 활성 계정 동기화 뒤에만 이전 저장본을 비우고 owner를 갱신한다', async () => {
  await saveSession({ accessToken: 'A_AT', refreshToken: 'A_RT', userId: 'user-a' });
  await rememberLocalDataOwner('user-a');
  const savedA = {
    ...initialState(true),
    name: 'A-only-private-state',
    settings: { ...initialState(true).settings, sound: false },
  };
  await AsyncStorage.setItem('gromo-r61-user-v2', JSON.stringify(savedA));
  await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'user-b' });
  mockRestoreSession.mockImplementation(() =>
    jest.requireActual('@/services/api/session').restoreSession(),
  );
  mockCheckSession.mockResolvedValue({
    status: 'active',
    account: {
      id: 'user-b',
      name: 'B',
      catColor: null,
      mainIslandId: null,
      linkedProviders: [],
      onboardingComplete: false,
    },
  });
  const serverMemberships = {
    items: [],
    nextCursor: null,
    currentIslandId: 'server-island-b',
    lossReason: null,
  };
  mockSyncIslands.mockImplementation(async () => {
    mockAppDispatch!({
      type: 'ISLAND_SYNC',
      memberships: serverMemberships,
      requests: [],
      mainIslandId: 'server-island-b',
    });
    return serverMemberships;
  });
  mockDecideBootRoute.mockImplementation(async ({ syncIslands }: any) => {
    const memberships = await syncIslands();
    return memberships.currentIslandId ? 'home' : 'chooseIsland';
  });

  await act(async () => {
    render(<App />);
    for (let n = 0; n < 20; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  assert.equal(mockCheckSession.mock.calls.length, 1);
  assert.equal(mockSyncIslands.mock.calls.length, 2);
  assert.equal(await mockDecideBootRoute.mock.results[0].value, 'home');
  await waitFor(() => assert.equal(mockDecideBootRoute.mock.calls.length, 2));
  await waitFor(() => assert.equal(getLastSessionUserId(), 'user-b'));

  assert.notEqual(captured.state.fish, 777);
  assert.equal(captured.state.settings.sound, false);
  await waitFor(() => {
    assert.equal(captured.state.loggedIn, true);
    assert.equal(captured.state.serverIslands.currentIslandId, 'server-island-b');
    assert.equal(captured.state.mainIslandId, 'server-island-b');
    assert.equal(captured.route, 'home');
  });
  await waitFor(async () => {
    const persisted = JSON.parse((await AsyncStorage.getItem('gromo-r61-user-v2'))!);
    assert.equal(persisted.loggedIn, true);
    assert.equal(persisted.serverIslands.currentIslandId, 'server-island-b');
  });
});

test('owner 불일치 부팅의 첫 동기화가 실패하면 재시도 성공 뒤에 owner 전환과 저장을 완료한다', async () => {
  await saveSession({ accessToken: 'A_AT', refreshToken: 'A_RT', userId: 'user-a' });
  await rememberLocalDataOwner('user-a');
  await AsyncStorage.setItem(
    'gromo-r61-user-v2',
    JSON.stringify({ ...initialState(true), name: 'A-only-private-state' }),
  );
  await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'user-b' });
  mockRestoreSession.mockImplementation(() =>
    jest.requireActual('@/services/api/session').restoreSession(),
  );
  mockCheckSession.mockResolvedValue({
    status: 'active',
    account: {
      id: 'user-b',
      name: 'B',
      catColor: null,
      mainIslandId: null,
      linkedProviders: [],
      onboardingComplete: false,
    },
  });
  const serverMemberships = {
    items: [],
    nextCursor: null,
    currentIslandId: 'server-island-b',
    lossReason: null,
  };
  mockSyncIslands.mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => {
    mockAppDispatch!({
      type: 'ISLAND_SYNC',
      memberships: serverMemberships,
      requests: [],
      mainIslandId: 'server-island-b',
    });
    return serverMemberships;
  });
  mockDecideBootRoute.mockImplementation(async ({ syncIslands }: any) => {
    try {
      const memberships = await syncIslands();
      return memberships.currentIslandId ? 'home' : 'chooseIsland';
    } catch {
      return 'chooseIsland';
    }
  });

  await act(async () => {
    render(<App />);
    for (let n = 0; n < 20; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await waitFor(() => assert.equal(captured.route, 'chooseIsland'));
  assert.equal(mockDecideBootRoute.mock.calls.length, 1);
  assert.equal(getLastSessionUserId(), 'user-a');
  assert.equal(
    JSON.parse((await AsyncStorage.getItem('gromo-r61-user-v2'))!).name,
    'A-only-private-state',
  );

  await act(async () => {
    await captured.islands.sync();
  });
  await waitFor(() => assert.equal(getLastSessionUserId(), 'user-b'));
  await waitFor(() => assert.equal(captured.route, 'home'));
  await waitFor(async () => {
    const persisted = JSON.parse((await AsyncStorage.getItem('gromo-r61-user-v2'))!);
    assert.equal(persisted.loggedIn, true);
    assert.notEqual(persisted.name, 'A-only-private-state');
    assert.equal(persisted.serverIslands.currentIslandId, 'server-island-b');
  });
});

test('두 번째 부팅 route await 중 generation이 바뀌면 stale route와 owner를 기록하지 않는다', async () => {
  await saveSession({ accessToken: 'A_AT', refreshToken: 'A_RT', userId: 'user-a' });
  await rememberLocalDataOwner('user-a');
  await AsyncStorage.setItem(
    'gromo-r61-user-v2',
    JSON.stringify({ ...initialState(true), settings: { ...initialState(true).settings } }),
  );
  await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'user-b' });
  mockRestoreSession.mockImplementation(() =>
    jest.requireActual('@/services/api/session').restoreSession(),
  );
  mockCheckSession.mockResolvedValue({
    status: 'active',
    account: {
      id: 'user-b',
      name: 'B',
      catColor: null,
      mainIslandId: null,
      linkedProviders: [],
      onboardingComplete: false,
    },
  });
  const serverMemberships = {
    items: [],
    nextCursor: null,
    currentIslandId: 'server-island-b',
    lossReason: null,
  };
  mockSyncIslands.mockImplementation(async () => serverMemberships);
  let resolveSecondRoute!: (route: string) => void;
  let signalSecondRoute!: () => void;
  const secondRouteStarted = new Promise<void>((resolve) => {
    signalSecondRoute = resolve;
  });
  mockDecideBootRoute.mockImplementation(async ({ syncIslands }: any) => {
    if (mockDecideBootRoute.mock.calls.length === 1) {
      await syncIslands();
      return 'login';
    }
    signalSecondRoute();
    return new Promise<string>((resolve) => {
      resolveSecondRoute = resolve;
    });
  });

  const renderPromise = render(<App />);
  await secondRouteStarted;
  await saveSession({ accessToken: 'C_AT', refreshToken: 'C_RT', userId: 'user-c' });
  resolveSecondRoute('home');
  await renderPromise;
  await waitFor(() => assert.equal(mockDecideBootRoute.mock.calls.length, 2));
  await waitFor(() => assert.ok(captured));
  assert.equal(captured.route, 'login');
  assert.equal(getLastSessionUserId(), 'user-a');
});

test('owner 불일치 세션이 오프라인이면 이전 데이터와 owner를 보존하고 메모리에 올리지 않는다', async () => {
  await saveSession({ accessToken: 'A_AT', refreshToken: 'A_RT', userId: 'user-a' });
  await rememberLocalDataOwner('user-a');
  const savedA = { ...initialState(true), name: 'A-only-private-state' };
  const rawA = JSON.stringify(savedA);
  await AsyncStorage.setItem('gromo-r61-user-v2', rawA);
  await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'user-b' });
  mockRestoreSession.mockImplementation(() =>
    jest.requireActual('@/services/api/session').restoreSession(),
  );

  await act(async () => {
    render(<App />);
    for (let n = 0; n < 20; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));

  assert.notEqual(captured.state.name, 'A-only-private-state');
  assert.equal(await AsyncStorage.getItem('gromo-r61-user-v2'), rawA);
  assert.equal(getLastSessionUserId(), 'user-a');
});

test('오프라인 mismatch 뒤 같은 owner로 로그인하면 보류한 저장본과 기기 설정을 복구한다', async () => {
  await saveSession({ accessToken: 'A_AT', refreshToken: 'A_RT', userId: 'user-a' });
  await rememberLocalDataOwner('user-a');
  const savedA = {
    ...initialState(true),
    owned: ['a-only-item'],
    fish: 777,
    settings: { ...initialState(true).settings, sound: false },
  };
  const rawA = JSON.stringify(savedA);
  await AsyncStorage.setItem('gromo-r61-user-v2', rawA);
  await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'user-b' });
  mockRestoreSession.mockImplementation(() =>
    jest.requireActual('@/services/api/session').restoreSession(),
  );

  await act(async () => {
    render(<App />);
    for (let n = 0; n < 20; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await waitFor(() => assert.equal(mockDecideBootRoute.mock.calls.length, 1));
  assert.notEqual(captured.state.name, 'A-only-private-state');
  assert.equal(await AsyncStorage.getItem('gromo-r61-user-v2'), rawA);

  await act(async () => clearSession());
  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin.mockImplementationOnce(async () => {
    const result = {
      accessToken: 'A_AT_2',
      refreshToken: 'A_RT_2',
      userId: 'user-a',
      onboardingComplete: true,
    };
    await saveSession(result);
    return result;
  });
  let applyAccountCalled = false;
  mockAdoptSignedInAccount.mockImplementationOnce(
    async (result: any, previousUserId, deps: any) => {
      const account = {
        id: result.userId,
        name: 'A',
        catColor: null,
        mainIslandId: null,
        linkedProviders: [],
        onboardingComplete: true,
      };
      if (previousUserId !== result.userId) await deps.resetLocal();
      const applyAccount = deps.applyAccount;
      deps.applyAccount = (next: any) => {
        applyAccountCalled = true;
        applyAccount(next);
      };
      deps.applyAccount(account);
      await deps.navigate(account);
      return account;
    },
  );

  await act(async () => captured.setTerms(true));
  await act(async () => captured.startSocial('google'));
  assert.equal(mockApiLogin.mock.calls.length, 1);
  assert.equal(mockAdoptSignedInAccount.mock.calls[0][1], 'user-a');
  assert.equal(applyAccountCalled, true);
  await waitFor(() => assert.deepEqual(captured.state.owned, ['a-only-item']));
  await waitFor(async () => {
    const persisted = JSON.parse((await AsyncStorage.getItem('gromo-r61-user-v2'))!);
    assert.deepEqual(persisted.owned, ['a-only-item']);
  });

  assert.equal(captured.state.name, 'A');
  assert.equal(captured.state.settings.sound, false);
  assert.equal(getLastSessionUserId(), 'user-a');
});

test('약관 버전 미설정 시 소셜 로그인과 회원 전환 경로를 화면 명령에 노출하지 않는다', async () => {
  delete process.env.EXPO_PUBLIC_TERMS_VERSION;
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured.islands));

  assert.deepEqual(captured.loginProviders, []);
  assert.equal(captured.startSocial, undefined);
  assert.equal(captured.conversion, undefined);
});

test('소셜 로그인은 SDK 자격을 서버에 보내고 취소는 오류로 표시하지 않는다', async () => {
  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin.mockImplementationOnce(async () => {
    const result = {
      accessToken: 'AT',
      refreshToken: 'RT',
      userId: 'u1',
      onboardingComplete: true,
    };
    await saveSession(result);
    return result;
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
  assert.equal(mockApiLogin.mock.calls[0][2], 'test-terms-v1');
  assert.equal(mockAdoptSignedInAccount.mock.calls.length, 1);
  await waitFor(() => assert.equal(captured.socialBusy, null));
  assert.equal(captured.socialError, '');
  // 새 세션 저장으로 generation이 바뀌면 이전 동의는 초기화된다.
  await waitFor(() => assert.equal(captured.terms, false));

  await act(async () => captured.setTerms(true));
  mockSocialCredential.mockRejectedValueOnce({ code: 'SIGN_IN_CANCELLED' });
  await act(async () => captured.startSocial('google'));
  assert.equal(mockSocialCredential.mock.calls.length, 2);
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

test('retryable 소셜 로그인 뒤 게스트 로그인은 이전 자격과 attemptId를 폐기한다', async () => {
  mockSocialCredential
    .mockResolvedValueOnce('first-google-token')
    .mockResolvedValueOnce('fresh-google-token');
  mockApiLogin
    .mockRejectedValueOnce(new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }))
    .mockResolvedValueOnce({
      accessToken: 'AT',
      refreshToken: 'RT',
      userId: 'member',
      onboardingComplete: true,
    });
  mockGuestLogin.mockImplementationOnce(async () => {
    const result = {
      accessToken: 'GUEST_AT',
      refreshToken: 'GUEST_RT',
      userId: 'guest',
      onboardingComplete: false,
    };
    await saveSession(result);
    return result;
  });
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await act(async () => captured.setTerms(true));

  await act(async () => captured.startSocial('google'));
  await act(async () => captured.startGuest());
  await waitFor(() => assert.equal(captured.guestBusy, false));
  await act(async () => captured.setTerms(true));
  await act(async () => captured.startSocial('google'));

  assert.equal(mockSocialCredential.mock.calls.length, 2);
  assert.equal(mockApiLogin.mock.calls[0][1], 'first-google-token');
  assert.equal(mockApiLogin.mock.calls[1][1], 'fresh-google-token');
  assert.notEqual(mockApiLogin.mock.calls[0][3].attemptId, mockApiLogin.mock.calls[1][3].attemptId);
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
  await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.equal(screen!.queryByText('소셜 계정으로 계속하기'), null));

  mockSocialCredential.mockRejectedValueOnce({ code: 'SIGN_IN_CANCELLED' });
  await act(async () => {
    captured.conversion.offer(
      new ApiError('SOCIAL_LOGIN_REQUIRED', '소셜 로그인이 필요합니다.', 403),
    );
  });
  await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
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

  await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.ok(screen!.getByText('처리 중')));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));

  assert.equal(mockSocialCredential.mock.calls.length, 1);
  assert.equal(mockApiLogin.mock.calls.length, 2);
  assert.equal(mockApiLogin.mock.calls[0][1], mockApiLogin.mock.calls[1][1]);
  assert.equal(mockApiLogin.mock.calls[0][3].attemptId, mockApiLogin.mock.calls[1][3].attemptId);
});

test('retryable 회원 전환 실패 뒤 시트를 닫으면 다시 열 때 새 SDK 자격과 attemptId를 쓴다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  mockSocialCredential
    .mockResolvedValueOnce('first-google-token')
    .mockResolvedValueOnce('fresh-google-token');
  mockApiLogin
    .mockRejectedValueOnce(new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }))
    .mockRejectedValueOnce(new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }))
    .mockRejectedValueOnce(
      new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }),
    );
  let screen: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    screen = await render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.equal(typeof captured.conversion?.offer, 'function'));
  const offer = () =>
    captured.conversion.offer(
      new ApiError('SOCIAL_LOGIN_REQUIRED', '회원 연동이 필요합니다.', 403),
    );

  await act(async () => offer());
  await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.ok(screen!.getByText('처리 중')));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  assert.equal(mockSocialCredential.mock.calls.length, 1);
  assert.equal(mockApiLogin.mock.calls[0][1], mockApiLogin.mock.calls[1][1]);
  assert.equal(mockApiLogin.mock.calls[0][3].attemptId, mockApiLogin.mock.calls[1][3].attemptId);

  await fireEvent.press(screen!.getByText('나중에'));
  await act(async () => offer());
  await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));

  assert.equal(mockSocialCredential.mock.calls.length, 2);
  assert.equal(mockApiLogin.mock.calls[2][1], 'fresh-google-token');
  assert.notEqual(mockApiLogin.mock.calls[1][3].attemptId, mockApiLogin.mock.calls[2][3].attemptId);
});

test('회원 전환 로그인 뒤 채택 실패는 저장된 결과와 자격으로 다시 채택한다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin
    .mockRejectedValueOnce(new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }))
    .mockImplementationOnce(async (_provider, _credential, _terms, options) => {
      const result = {
        accessToken: 'AT',
        refreshToken: 'RT',
        userId: 'member',
        onboardingComplete: true,
      };
      options.onSessionPublished(result, sessionGeneration() + 1);
      await saveSession(result);
      return result;
    });
  mockAdoptSignedInAccount.mockRejectedValueOnce(new Error('temporary /me failure'));
  let screen: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    screen = await render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.equal(typeof captured.conversion?.offer, 'function'));
  await act(async () => {
    captured.conversion.offer(
      new ApiError('SOCIAL_LOGIN_REQUIRED', '회원 연동이 필요합니다.', 403),
    );
  });

  await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.ok(screen!.getByText('처리 중')));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  assert.equal(mockApiLogin.mock.calls.length, 2);
  assert.equal(mockAdoptSignedInAccount.mock.calls.length, 1);
  await waitFor(() => assert.ok(screen!.getByText('문제가 생겼어요. 다시 시도해 주세요.')));

  // 로그인은 이미 성공했으므로 약관 동의를 유지하고, 채택 복구 중에는 시트를 닫지 못한다.
  const terms = screen!.getByTestId('member-conversion-terms');
  assert.equal(terms.props.accessibilityState.checked, true);
  assert.equal(terms.props.accessibilityState.disabled, true);
  assert.equal(screen!.getByLabelText('나중에').props.accessibilityState.disabled, true);
  const modal = screen!.container.queryAll((instance) => instance.type === 'Modal')[0];
  await act(async () => {
    modal.props.onRequestClose();
    modal.props.children.props.onPress();
  });
  await fireEvent.press(screen!.getByText('나중에'));
  assert.ok(screen!.getByText('소셜 계정으로 계속하기'));

  // 같은 provider 버튼으로 채택을 재시도할 수 있고, 로그인/SDK 재호출은 없다.
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.equal(screen!.queryByText('소셜 계정으로 계속하기'), null));

  assert.equal(mockSocialCredential.mock.calls.length, 1);
  assert.equal(mockApiLogin.mock.calls.length, 2);
  assert.equal(mockAdoptSignedInAccount.mock.calls.length, 2);
  assert.equal(mockAdoptSignedInAccount.mock.calls[0][0].userId, 'member');
  assert.equal(mockAdoptSignedInAccount.mock.calls[1][0].userId, 'member');
  assert.equal(mockAdoptSignedInAccount.mock.calls[0][1], 'guest');
  assert.equal(mockAdoptSignedInAccount.mock.calls[1][1], 'guest');
});

test('회원 전환 동의는 provider 실행을 잠그고 시트 닫기·세션 변경 시 초기화한다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  let screen: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    screen = await render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.equal(typeof captured.conversion?.offer, 'function'));
  const offer = () =>
    captured.conversion.offer(
      new ApiError('SOCIAL_LOGIN_REQUIRED', '회원 연동이 필요합니다.', 403),
    );

  await act(async () => offer());
  const checkbox = screen!.getByTestId('member-conversion-terms');
  assert.ok(screen!.getByTestId('policy-link-terms'));
  assert.ok(screen!.getByTestId('policy-link-privacy'));
  assert.equal(checkbox.props.accessibilityState.checked, false);
  assert.equal(screen!.getByLabelText('Google로 계속하기').props.accessibilityState.disabled, true);
  await fireEvent.press(screen!.getByLabelText('Google로 계속하기'));
  assert.equal(mockSocialCredential.mock.calls.length, 0);

  await fireEvent.press(checkbox);
  assert.equal(
    screen!.getByTestId('member-conversion-terms').props.accessibilityState.checked,
    true,
  );
  await fireEvent.press(screen!.getByText('나중에'));
  await act(async () => offer());
  assert.equal(
    screen!.getByTestId('member-conversion-terms').props.accessibilityState.checked,
    false,
  );

  await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
  await act(async () => captured.setTerms(true));
  await act(async () => {
    await saveSession({
      accessToken: 'NEW_GUEST_AT',
      refreshToken: 'NEW_GUEST_RT',
      userId: 'guest-2',
    });
  });
  await waitFor(() =>
    assert.equal(
      screen!.getByTestId('member-conversion-terms').props.accessibilityState.checked,
      false,
    ),
  );
  assert.equal(captured.terms, false);
});

test('세션 generation 변경 뒤 회원 전환은 새 SDK 자격과 새 attemptId를 쓴다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  mockSocialCredential
    .mockResolvedValueOnce('old-google-token')
    .mockResolvedValueOnce('new-google-token');
  mockApiLogin
    .mockRejectedValueOnce(new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }))
    .mockRejectedValueOnce(
      new ApiError('REQUEST_IN_PROGRESS', '처리 중', 409, { retryable: true }),
    );
  let screen: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    screen = await render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.equal(typeof captured.conversion?.offer, 'function'));
  await act(async () => {
    captured.conversion.offer(
      new ApiError('SOCIAL_LOGIN_REQUIRED', '회원 연동이 필요합니다.', 403),
    );
  });
  await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));
  await waitFor(() => assert.equal(screen!.getByText('처리 중').props.children, '처리 중'));

  await act(async () => {
    await saveSession({
      accessToken: 'NEW_GUEST_AT',
      refreshToken: 'NEW_GUEST_RT',
      userId: 'guest-2',
    });
  });
  await waitFor(() =>
    assert.equal(
      screen!.getByTestId('member-conversion-terms').props.accessibilityState.checked,
      false,
    ),
  );
  await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
  await fireEvent.press(screen!.getByText('Google로 계속하기'));

  assert.equal(mockSocialCredential.mock.calls.length, 2);
  assert.equal(mockApiLogin.mock.calls[0][1], 'old-google-token');
  assert.equal(mockApiLogin.mock.calls[1][1], 'new-google-token');
  assert.notEqual(mockApiLogin.mock.calls[0][3].attemptId, mockApiLogin.mock.calls[1][3].attemptId);
});

test('계정 전환 중 로컬 저장 삭제 실패는 채택과 owner 갱신을 중단한다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  await rememberLocalDataOwner('guest');
  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin.mockImplementationOnce(async () => {
    await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'member' });
    return {
      accessToken: 'AT',
      refreshToken: 'RT',
      userId: 'member',
      onboardingComplete: true,
    };
  });
  let applyCalls = 0;
  let navigateCalls = 0;
  mockAdoptSignedInAccount.mockImplementationOnce(
    async (result: any, _previous: any, deps: any) => {
      const account = {
        id: result.userId,
        name: null,
        catColor: null,
        mainIslandId: null,
        linkedProviders: [],
        onboardingComplete: true,
      };
      await deps.resetLocal();
      applyCalls += 1;
      deps.applyAccount(account);
      navigateCalls += 1;
      await deps.navigate(account);
      return account;
    },
  );
  const remove = jest
    .spyOn(AsyncStorage, 'removeItem')
    .mockRejectedValueOnce(new Error('storage unavailable'));

  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await act(async () => captured.setTerms(true));
  await act(async () => captured.startSocial('google'));

  assert.equal(mockApiLogin.mock.calls.length, 1);
  assert.equal(mockAdoptSignedInAccount.mock.calls.length, 1);
  assert.equal(remove.mock.calls.length, 1);
  assert.equal(applyCalls, 0);
  assert.equal(navigateCalls, 0);
  assert.equal(getLastSessionUserId(), 'guest');
  assert.equal(captured.socialError, '로그인을 완료하지 못했어요. 다시 시도해 주세요.');
  remove.mockRestore();
});

test('A→B 채택 진행 중과 실패 뒤에는 B 상태를 A owner 아래 저장하지 않는다', async () => {
  const storageKey = 'gromo-r61-user-v2';
  await saveSession({ accessToken: 'A_AT', refreshToken: 'A_RT', userId: 'user-a' });
  await rememberLocalDataOwner('user-a');
  await AsyncStorage.setItem(
    storageKey,
    JSON.stringify({
      ...initialState(true),
      name: 'A-private-state',
      settings: { ...initialState(true).settings },
    }),
  );
  mockRestoreSession.mockImplementation(() =>
    jest.requireActual('@/services/api/session').restoreSession(),
  );
  mockCheckSession.mockResolvedValue({
    status: 'active',
    account: {
      id: 'user-a',
      name: 'A',
      catColor: null,
      mainIslandId: null,
      linkedProviders: [],
      onboardingComplete: true,
    },
  });
  mockDecideBootRoute.mockResolvedValue('home');

  await act(async () => {
    render(<App />);
    for (let n = 0; n < 20; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await waitFor(() => assert.equal(captured.route, 'home'));
  await waitFor(() => assert.equal(getLastSessionUserId(), 'user-a'));

  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin.mockImplementationOnce(async () => {
    const result = {
      accessToken: 'B_AT',
      refreshToken: 'B_RT',
      userId: 'user-b',
      onboardingComplete: true,
    };
    await saveSession(result);
    return result;
  });
  let rejectNavigate!: (error: Error) => void;
  let markNavigationStarted!: () => void;
  const navigationStarted = new Promise<void>((resolve) => {
    markNavigationStarted = resolve;
  });
  const bootDecisionCount = mockDecideBootRoute.mock.calls.length;
  mockDecideBootRoute.mockImplementation(async () => {
    if (mockDecideBootRoute.mock.calls.length > bootDecisionCount) {
      markNavigationStarted();
      return new Promise((_resolve, reject) => (rejectNavigate = reject));
    }
    return 'home';
  });
  let resetLocalCalls = 0;
  mockAdoptSignedInAccount.mockImplementationOnce(
    async (result: any, previousUserId: string | null, deps: any) => {
      const account = {
        id: result.userId,
        name: 'B',
        catColor: null,
        mainIslandId: null,
        linkedProviders: [],
        onboardingComplete: true,
      };
      if (previousUserId !== result.userId) {
        resetLocalCalls += 1;
        await deps.resetLocal();
      }
      deps.applyAccount(account);
      await deps.navigate(account);
      return account;
    },
  );

  await act(async () => captured.setTerms(true));
  let login!: Promise<void>;
  await act(async () => {
    login = captured.startSocial('google');
    for (let n = 0; n < 20; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.equal(mockAdoptSignedInAccount.mock.calls.length, 1));
  await navigationStarted;
  assert.equal(resetLocalCalls, 1);
  await waitFor(() => assert.equal(captured.state.name, 'B'));
  const whileNavigating = await AsyncStorage.getItem(storageKey);
  assert.ok(!whileNavigating || JSON.parse(whileNavigating).name !== 'B');
  assert.equal(getLastSessionUserId(), 'user-a');

  await act(async () => rejectNavigate(new Error('B route sync failed')));
  await act(async () => login);
  const afterFailure = await AsyncStorage.getItem(storageKey);
  assert.ok(!afterFailure || JSON.parse(afterFailure).name !== 'B');
  assert.equal(getLastSessionUserId(), 'user-a');
  mockDecideBootRoute.mockReset();
});

test('로그아웃 기록을 기기에 남기지 못하면 signOut은 false로 로그인 화면 전환을 막는다', async () => {
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  mockPrepareLogout.mockRejectedValueOnce(new Error('tombstone 실패'));

  let result: boolean | undefined;
  await act(async () => {
    result = await captured.signOut();
  });
  assert.equal(result, false);
  assert.equal(mockLogout.mock.calls.length, 0);
  assert.ok(screen.getByText(/로그아웃하지 못했어요/));

  const prepared = Promise.resolve();
  mockPrepareLogout.mockReturnValueOnce(prepared);
  await act(async () => {
    result = await captured.signOut();
  });
  assert.equal(result, true);
  assert.equal(mockLogout.mock.calls.length, 1);
  // 화면 전환 판단에 쓴 준비 결과를 실제 정리에 그대로 넘긴다 — 다시 준비하지 않는다.
  assert.equal(mockLogout.mock.calls[0][0], prepared);
  assert.equal(mockPrepareLogout.mock.calls.length, 2);
});

test('계정·섬 온보딩이 끝날 때까지 지원 딥링크를 보관한다', async () => {
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await waitFor(() => assert.ok(mockEmitAppLink));
  const memberships = (currentIslandId: string | null) => ({
    items: [],
    nextCursor: null,
    currentIslandId,
    lossReason: null,
  });
  await act(async () => {
    await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
    mockAppDispatch!({
      type: 'ISLAND_SYNC',
      memberships: memberships(null),
      requests: [],
      mainIslandId: null,
    });
  });
  await act(async () => captured.reset('character'));
  await waitFor(() => assert.equal(captured.state.onboarded, false));

  await act(async () => mockEmitAppLink!('gromo://friends'));
  assert.equal(captured.route, 'character');
  await act(async () => captured.reset('chooseIsland'));
  assert.equal(captured.route, 'chooseIsland');

  await act(async () => {
    mockAppDispatch!({
      type: 'ISLAND_SYNC',
      memberships: memberships('island-1'),
      requests: [],
      mainIslandId: 'island-1',
    });
    captured.reset('home');
  });
  await waitFor(() => assert.equal(captured.route, 'friends'));
});

test('미인증 상태의 지원 불가 레거시 링크는 로그인 화면을 벗어난 뒤에 홈 안내로 처리한다', async () => {
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await waitFor(() => assert.ok(mockEmitAppLink));
  await waitFor(() => assert.equal(captured.route, 'login'));

  await act(async () => mockEmitAppLink!('gromo://join?g=group-id'));
  assert.equal(screen.queryByText(/지원하지 않아 홈으로 이동했어요/), null);
  assert.equal(captured.route, 'login');

  await act(async () => {
    await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  });
  assert.equal(screen.queryByText(/지원하지 않아 홈으로 이동했어요/), null);

  await act(async () => {
    mockAppDispatch!({
      type: 'ISLAND_SYNC',
      memberships: { items: [], nextCursor: null, currentIslandId: 'island-1', lossReason: null },
      requests: [],
      mainIslandId: 'island-1',
    });
    captured.reset('home');
  });
  await waitFor(() => assert.ok(screen.getByText(/지원하지 않아 홈으로 이동했어요/)));
  assert.equal(captured.route, 'home');
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
