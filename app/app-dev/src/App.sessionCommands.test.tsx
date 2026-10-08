import assert from 'node:assert/strict';
import * as SecureStore from 'expo-secure-store';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '@/App';
import type { Account } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import {
  clearLocalDataOwner,
  clearSession,
  getLastSessionUserId,
  rememberLocalDataOwner,
  saveSession,
  sessionGeneration,
} from '@/services/api/session';
import { applyLocalePref, getLocale } from '@/i18n';
import { initialState, reducer, type Route } from '@/services/model';
import {
  cancelBuildingTransition,
  createBuildingTransitionController,
} from '@/services/buildingTransition';

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
const mockClearStudyWidget = jest.fn(async () => false);
let mockEmitAppLink: ((url: string) => void) | undefined;
let mockRememberOverride: ((...args: any[]) => Promise<boolean>) | undefined;
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
let mockBootRoute: Route = 'login';

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

jest.mock('@/services/studyWidget', () => ({
  ...jest.requireActual('@/services/studyWidget'),
  clearStudyWidget: () => mockClearStudyWidget(),
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
    rememberLocalDataOwner: (...args: any[]) =>
      mockRememberOverride ? mockRememberOverride(...args) : actual.rememberLocalDataOwner(...args),
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
  mockBootRoute = 'login';
  mockDecideBootRoute.mockImplementation(async () => mockBootRoute);
  mockSyncIslands.mockReset();
  mockSyncIslands.mockResolvedValue({ currentIslandId: null, items: [] });
  mockRecoverFocus.mockResolvedValue(null);
  mockAppDispatch = undefined;
  mockRememberOverride = undefined;
  await clearSession();
  await SecureStore.deleteItemAsync('gromo.lastUserId');
  await SecureStore.deleteItemAsync('gromo.ownerAdoptionPending');
  // 앞 테스트의 앱 저장본(섬·온보딩 상태)이 다음 테스트의 부팅 LOAD로 새지 않게 비운다.
  // removeItem 호출 수를 세는 테스트가 있어 multiRemove로 지운다. 언어 키는 기기 전역 값이라 앱이 안 지우니 여기서 비운다.
  await AsyncStorage.multiRemove(['gromo-r61-user-v2', 'gromo.locale', 'gromo:settings:locale']);
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

  // 재시도에서 동기화는 성공했지만 owner 기록이 한 번 거절되면 실패로 알리고 보류를 유지한다.
  let rejectOwnerOnce = true;
  mockRememberOverride = async (...args: any[]) => {
    if (rejectOwnerOnce && args[0] === 'user-b') {
      rejectOwnerOnce = false;
      return false;
    }
    return jest.requireActual('@/services/api/session').rememberLocalDataOwner(...args);
  };
  await act(async () => {
    await assert.rejects(captured.islands.sync(), /소유자를 기록하지 못했어요/);
  });
  assert.equal(getLastSessionUserId(), 'user-a');

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

test('렌더 전 소셜 로그인 연타와 게스트·소셜 교차 시작은 한 흐름만 통과한다', async () => {
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

  // 같은 렌더의 명령을 잡아 두고 연달아 부른다 — socialBusy state 가 아직 반영되지 않은 연타다.
  const { startSocial, startGuest } = captured;
  let first!: Promise<void>;
  await act(async () => {
    first = startSocial('google');
    void startSocial('google');
    void startGuest();
    await Promise.resolve();
  });
  assert.equal(mockSocialCredential.mock.calls.length, 1);
  assert.equal(mockGuestLogin.mock.calls.length, 0);
  resolveCredential('google-id-token');
  await act(async () => first);
  assert.equal(mockApiLogin.mock.calls.length, 1);

  // 게스트 시작이 진행 중이면 같은 렌더의 소셜 시작도 막힌다.
  let resolveGuest: (value: unknown) => void = () => {};
  mockGuestLogin.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveGuest = resolve;
      }),
  );
  await waitFor(() => assert.equal(captured.socialBusy, null));
  await act(async () => captured.setTerms(true));
  const next = captured;
  let guest!: Promise<void>;
  await act(async () => {
    guest = next.startGuest();
    void next.startSocial('kakao');
    await Promise.resolve();
  });
  assert.equal(mockGuestLogin.mock.calls.length, 1);
  assert.equal(mockSocialCredential.mock.calls.length, 1);
  resolveGuest(Promise.reject(new Error('guest failed')));
  await act(async () => guest);
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
  // 이전 계정 저장본을 지우지 못했으면 위젯도 그대로 둔다(전환이 확정되지 않았다).
  assert.equal(mockClearStudyWidget.mock.calls.length, 0);
  remove.mockRestore();
});

test('다른 계정으로 전환해 이전 계정 저장본을 지우면 안드로이드 홈 위젯도 비운다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
  await rememberLocalDataOwner('guest');
  mockSocialCredential.mockResolvedValueOnce('google-id-token');
  mockApiLogin.mockImplementationOnce(async () => {
    const result = { accessToken: 'AT', refreshToken: 'RT', userId: 'member' };
    await saveSession(result);
    return { ...result, onboardingComplete: true };
  });
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
      deps.applyAccount(account);
      await deps.navigate(account);
      return account;
    },
  );

  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await act(async () => captured.setTerms(true));
  await act(async () => captured.startSocial('google'));

  assert.equal(captured.socialError, '');
  assert.equal(mockClearStudyWidget.mock.calls.length, 1);
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

test('채택 resetLocal이 저장 큐를 기다리는 사이 세션 세대가 바뀌면 저장본을 지우지 않는다', async () => {
  const storageKey = 'gromo-r61-user-v2';
  await saveSession({ accessToken: 'A_AT', refreshToken: 'A_RT', userId: 'user-a' });
  await rememberLocalDataOwner('user-a');
  await AsyncStorage.setItem(
    storageKey,
    JSON.stringify({ ...initialState(true), name: 'A-private-state' }),
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

  // A 저장 하나를 붙잡아 큐를 pending 상태로 만든다.
  let releaseWrite!: () => void;
  const writeHeld = new Promise<void>((resolve) => (releaseWrite = resolve));
  let markWriteStarted!: () => void;
  const writeStarted = new Promise<void>((resolve) => (markWriteStarted = resolve));
  // jest.setup 의 AsyncStorage 는 이미 jest.fn 이라 spyOn·mockRestore 는 구현을 지운다. 구현만 바꿨다 되돌린다.
  const setItem = AsyncStorage.setItem as jest.Mock;
  const realSetItem = setItem.getMockImplementation()!;
  setItem.mockImplementation(async (key: string, value: string) => {
    if (key === storageKey) {
      markWriteStarted();
      await writeHeld;
    }
    return realSetItem(key, value);
  });
  await act(async () => captured.dispatch({ type: 'PROFILE', name: 'A-pending-write' }));
  await writeStarted;

  staleAdoptionLogin();
  let resetSettled = false;
  let markResetStarted!: () => void;
  const resetStarted = new Promise<void>((resolve) => (markResetStarted = resolve));
  mockAdoptSignedInAccount.mockImplementationOnce(
    async (result: any, _previous: any, deps: any) => {
      const account = staleAccount(result.userId);
      markResetStarted();
      await deps.resetLocal().finally(() => (resetSettled = true));
      deps.applyAccount(account);
      await deps.navigate(account);
      return account;
    },
  );
  const removeItem = AsyncStorage.removeItem as jest.Mock;
  const removeCallsBefore = removeItem.mock.calls.length;
  await act(async () => captured.setTerms(true));
  let login!: Promise<void>;
  await act(async () => {
    login = captured.startSocial('google');
    for (let n = 0; n < 20; n += 1) await Promise.resolve();
  });
  await resetStarted;
  assert.equal(resetSettled, false);

  // 큐를 기다리는 사이 새 세션이 공개됐다(로그아웃 뒤 재로그인 등).
  await act(async () => {
    await saveSession({ accessToken: 'C_AT', refreshToken: 'C_RT', userId: 'user-c' });
  });
  await act(async () => {
    releaseWrite();
    await login;
  });

  assert.equal(resetSettled, true);
  assert.equal(
    removeItem.mock.calls.slice(removeCallsBefore).filter(([key]) => key === storageKey).length,
    0,
  );
  assert.notEqual(captured.state.name, 'stale-B');
  setItem.mockImplementation(realSetItem);
  mockDecideBootRoute.mockReset();
});

test('일반 로그인 뒤 owner 기록이 일시 실패하면 알리고 같은 세션에서 자동 재시도해 저장을 연다', async () => {
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
  let rejectOwnerOnce = true;
  mockRememberOverride = async (...args: any[]) => {
    if (rejectOwnerOnce && args[0] === 'u1') {
      rejectOwnerOnce = false;
      return false;
    }
    return jest.requireActual('@/services/api/session').rememberLocalDataOwner(...args);
  };
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  await act(async () => captured.setTerms(true));
  await act(async () => captured.startSocial('google'));

  assert.equal(captured.socialError, '');
  assert.ok(screen.getByText(/변경 내용이 아직 저장되지 않아요/));
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);

  await waitFor(
    async () => assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), 'u1'),
    { timeout: 3000 },
  );
  await act(async () => captured.dispatch({ type: 'PROFILE', name: '저장확인' }));
  await waitFor(async () => {
    const persisted = JSON.parse((await AsyncStorage.getItem('gromo-r61-user-v2')) ?? 'null');
    assert.equal(persisted?.name, '저장확인');
  });
});

const staleAdoptionLogin = () => {
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
};
const staleAccount = (id: string): Account => ({
  id,
  name: 'stale-B',
  catColor: null,
  mainIslandId: null,
  linkedProviders: ['google'],
  onboardingComplete: true,
});

test('채택 중 /me 응답 뒤 세션 세대가 바뀌면 LOGIN·PROFILE·화면 이동·owner 기록을 조용히 버린다', async () => {
  staleAdoptionLogin();
  let resetLocalCalls = 0;
  mockAdoptSignedInAccount.mockImplementationOnce(
    async (result: any, _previous: any, deps: any) => {
      const account = staleAccount(result.userId);
      // /me 응답을 기다리는 사이 401 정리가 끝나 세대가 올라갔다.
      await clearSession(sessionGeneration());
      await deps.resetLocal().then(() => (resetLocalCalls += 1));
      deps.applyAccount(account);
      await deps.navigate(account);
      return account;
    },
  );
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  const routeBefore = captured.route;
  const bootDecisions = mockDecideBootRoute.mock.calls.length;
  await act(async () => captured.setTerms(true));
  await act(async () => captured.startSocial('google'));

  assert.equal(mockAdoptSignedInAccount.mock.calls.length, 1);
  assert.equal(resetLocalCalls, 0);
  assert.equal(captured.socialError, '');
  assert.notEqual(captured.state.name, 'stale-B');
  assert.equal(mockDecideBootRoute.mock.calls.length, bootDecisions);
  assert.equal(captured.route, routeBefore);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
});

test('채택 중 섬 동기화 await 사이 세션 세대가 바뀌면 늦은 route와 owner를 적용하지 않는다', async () => {
  staleAdoptionLogin();
  const remember = jest.fn();
  mockRememberOverride = async (...args: any[]) => {
    remember(...args);
    return jest.requireActual('@/services/api/session').rememberLocalDataOwner(...args);
  };
  await act(async () => {
    render(<App />);
    for (let n = 0; n < 10; n += 1) await Promise.resolve();
  });
  await waitFor(() => assert.ok(captured));
  mockDecideBootRoute.mockImplementationOnce(async () => {
    // /me/islands 동기화 도중 다른 로그인이 새 세션을 공개했다.
    await saveSession({ accessToken: 'C_AT', refreshToken: 'C_RT', userId: 'user-c' });
    return 'home';
  });
  mockAdoptSignedInAccount.mockImplementationOnce(
    async (result: any, _previous: any, deps: any) => {
      const account = staleAccount(result.userId);
      deps.applyAccount(account);
      await deps.navigate(account);
      return account;
    },
  );
  await act(async () => captured.setTerms(true));
  await act(async () => captured.startSocial('google'));

  assert.equal(captured.socialError, '');
  assert.notEqual(captured.route, 'home');
  assert.equal(remember.mock.calls.length, 0);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
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
  // 세션이 남는 실패에서는 위젯도 그대로 둔다.
  assert.equal(mockClearStudyWidget.mock.calls.length, 0);

  const prepared = Promise.resolve();
  mockPrepareLogout.mockReturnValueOnce(prepared);
  await act(async () => {
    result = await captured.signOut();
  });
  assert.equal(result, true);
  assert.equal(mockLogout.mock.calls.length, 1);
  // 로그아웃하면 이전 계정의 공부시간이 런처 위젯에 남지 않게 비운다.
  assert.equal(mockClearStudyWidget.mock.calls.length, 1);
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
  // 첫 섬 합류는 필수 안내로 이어진다. 안내 중에도 링크를 보관한다.
  await waitFor(() => assert.equal(captured.route, 'guide'));
  assert.equal(captured.route, 'guide');
  // 안내 화면을 벗어나면 보관한 링크를 연다.
  await act(async () => captured.reset('settings'));
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

test.each([
  ['focus', 11, 'active', 11],
  ['focus', 18, 'active', 17],
  ['rest', 11, 'paused', 15],
] as const)(
  '저장본을 읽는 실제 앱 부팅: %s 화면의 %s단계를 %s 세션에 맞춰 %s로 복구한다',
  async (route, step, status, expected) => {
    mockBootRoute = route;
    let saved = reducer(initialState(true), {
      type: 'START',
      subject: '복구 테스트',
      now: Date.now(),
    });
    saved.session!.status = status;
    saved = reducer(saved, { type: 'GUIDE_STEP', step });
    await AsyncStorage.setItem('gromo-r61-user-v2', JSON.stringify(saved));
    const app = await render(<App />);
    await waitFor(() => expect(captured?.guideStep).toBe(expected));
    expect(captured.state.session.id).toBe(saved.session!.id);
    expect(captured.route).toBe(route);
    await waitFor(async () => {
      const stored = JSON.parse((await AsyncStorage.getItem('gromo-r61-user-v2'))!);
      expect(stored.tutorial).toEqual({ step: expected, sessionId: saved.session!.id });
    });
    await app.unmount();
  },
);

test('복구된 결과·집중 화면은 남아 있던 휴식 안내 단계를 함께 맞춘다', async () => {
  mockBootRoute = 'rest';
  let saved = reducer(initialState(true), {
    type: 'START',
    subject: '복구 테스트',
    now: Date.now(),
  });
  saved = reducer(saved, { type: 'PAUSE', now: Date.now() });
  saved = reducer(saved, { type: 'GUIDE_STEP', step: 15 });
  await AsyncStorage.setItem('gromo-r61-user-v2', JSON.stringify(saved));
  const app = await render(<App />);
  await waitFor(() => expect(captured?.guideStep).toBe(15));
  await act(async () => {
    captured.dispatch({ type: 'RESUME' });
    captured.reset('focus');
  });
  await waitFor(() => expect(captured.guideStep).toBe(16));
  await act(async () => {
    captured.dispatch({ type: 'FINISH' });
    captured.reset('focusResult');
  });
  await waitFor(() => expect(captured.guideStep).toBe(19));
  await app.unmount();
});

test.each(['next-island', null])(
  '체험 중 소속이 %s로 바뀌면 체험을 지우고 안전한 화면으로 돌아간다',
  async (nextIsland) => {
    mockBootRoute = 'home';
    const app = await render(<App />);
    await waitFor(() => expect(captured).toBeTruthy());
    await act(async () => {
      captured.dispatch({
        type: 'ISLAND_SYNC',
        memberships: { items: [{ id: 'first-island' }], currentIslandId: 'first-island' },
      });
      captured.dispatch({ type: 'GUIDE_STEP', step: 8 });
      captured.dispatch({ type: 'TUTORIAL_EXPERIENCE_START', subject: '체험' });
      captured.dispatch({ type: 'GUIDE_STEP', step: 11 });
      captured.reset('focus');
    });
    await waitFor(() =>
      expect(captured.state.tutorialExperience?.session?.islandId).toBe('first-island'),
    );
    await act(async () => {
      captured.dispatch({
        type: 'ISLAND_SYNC',
        memberships: { items: nextIsland ? [{ id: nextIsland }] : [], currentIslandId: nextIsland },
      });
    });
    await waitFor(() => expect(captured.route).toBe(nextIsland ? 'home' : 'chooseIsland'));
    expect(captured.state.tutorialExperience).toBeUndefined();
    expect(captured.state.session).toBeNull();
    expect(captured.guideStep).toBe(4);
    await app.unmount();
  },
);

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
  await act(async () => captured.setGuideStep(14));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await act(async () => captured.go('rest'));

  await act(async () => {
    assert.equal(cancelBuildingTransition(), true);
  });
  await waitFor(() => assert.equal(captured.state.session?.status, 'active'));
  assert.equal(captured.route, 'focus');
  assert.equal(captured.guideStep, 14);
});

test('실제 모닥불 전환이 완료돼야 14단계에서 15단계로 진행한다', async () => {
  let saved = reducer(initialState(true), { type: 'START', subject: '이동 테스트' });
  saved = reducer(saved, { type: 'GUIDE_STEP', step: 14 });
  await AsyncStorage.setItem('gromo-r61-user-v2', JSON.stringify(saved));
  mockBootRoute = 'focus';
  const app = await render(<App />);
  await waitFor(() => expect(captured?.guideStep).toBe(14));
  await act(async () => {
    captured.dispatch({ type: 'PAUSE' });
  });
  await act(async () => captured.go('rest'));
  expect(captured.guideStep).toBe(14);
  await waitFor(() => expect(captured.route).toBe('rest'), { timeout: 4000 });
  // 15단계는 route 가 rest 로 바뀐 뒤 튜토리얼 effect 가 정하므로 한 렌더 늦을 수 있다.
  await waitFor(() => expect(captured.guideStep).toBe(15));
  await app.unmount();
});

test('승인 대기 후 부팅에서 첫 소속이 확인되면 홈 대신 첫 안내를 연다', async () => {
  let saved = reducer(initialState(), {
    type: 'ISLAND_SYNC',
    memberships: { items: [], currentIslandId: null, lossReason: null },
  });
  saved = reducer(saved, {
    type: 'ISLAND_SYNC',
    memberships: { items: [{ id: 'first' }], currentIslandId: 'first', lossReason: null },
  });
  await AsyncStorage.setItem('gromo-r61-user-v2', JSON.stringify(saved));
  mockBootRoute = 'home';
  const app = await render(<App />);
  await waitFor(() => expect(captured?.route).toBe('guide'));
  expect(captured.guideStep).toBe(0);
  await app.unmount();
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

test('부팅은 언어 설정(gromo.locale)을 읽고, 없으면 1.x 키(gromo:settings:locale) 값을 적용한다', async () => {
  await AsyncStorage.setItem('gromo:settings:locale', 'en');
  try {
    await act(async () => {
      render(<App />);
      for (let n = 0; n < 10; n += 1) await Promise.resolve();
    });
    await waitFor(() => assert.ok(captured));
    const read = (AsyncStorage.getItem as jest.Mock).mock.calls.map(([key]) => key);
    assert.ok(read.includes('gromo.locale'));
    assert.equal(getLocale(), 'en');
    assert.equal(captured.localePref, 'en');
  } finally {
    await AsyncStorage.multiRemove(['gromo:settings:locale']);
    applyLocalePref(null);
  }
});

test('로그아웃·탈퇴 정리는 기기 전역 언어 설정(gromo.locale)을 지우지 않는다', async () => {
  // 앞 테스트의 spyOn·mockRestore 가 removeItem 구현을 지웠을 수 있다 — 공식 목과 같은 구현을 잠시 쓴다.
  const removeItem = AsyncStorage.removeItem as jest.Mock;
  const previousRemove = removeItem.getMockImplementation();
  removeItem.mockImplementation((key: string) => AsyncStorage.multiRemove([key]));
  try {
    await AsyncStorage.setItem('gromo.locale', 'en');
    // 탈퇴 응답을 잃고 종료됐던 기기 — 부팅이 확정된 탈퇴 의도로 로컬 정리와 앱 저장본 삭제를 마친다.
    await clearLocalDataOwner();
    await AsyncStorage.setItem(
      'gromo.withdrawalIntent',
      JSON.stringify({ userId: 'withdrawn-user', key: 'k', confirmed: true }),
    );
    await act(async () => {
      render(<App />);
      for (let n = 0; n < 10; n += 1) await Promise.resolve();
    });
    await waitFor(() => assert.ok(captured));
    let signedOut: boolean | undefined;
    await act(async () => {
      signedOut = await captured.signOut();
    });
    assert.equal(signedOut, true);

    const removed = removeItem.mock.calls.map(([key]) => key);
    assert.ok(removed.includes('gromo-r61-user-v2')); // 탈퇴 정리 경로를 실제로 탔다
    assert.ok(!removed.includes('gromo.locale'));
    assert.equal(await AsyncStorage.getItem('gromo.locale'), 'en');
  } finally {
    removeItem.mockImplementation(previousRemove);
    await AsyncStorage.multiRemove(['gromo.locale']);
    applyLocalePref(null);
  }
});

test('en 로케일 — 게스트→회원 시트는 영문 제목을 보여주고 서버 오류도 번역해 보여준다', async () => {
  // App 부팅이 저장된 'gromo.locale' 을 읽어 적용한다 — 렌더 전에 미리 건 applyLocalePref 는
  // 이 부팅 적용이 끝나는 순간 덮어써진다(T1 locale 부팅 테스트와 같은 이유).
  await AsyncStorage.setItem('gromo.locale', 'en');
  try {
    await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'guest' });
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
    assert.ok(screen!.getByText('Continue with a Social Account'));

    mockSocialCredential.mockRejectedValueOnce(
      new ApiError('GOOGLE_TOKEN', '회원 전환 토큰 오류', 422),
    );
    await fireEvent.press(screen!.getByTestId('member-conversion-terms'));
    await fireEvent.press(screen!.getByText('Continue with Google'));

    await waitFor(() => assert.ok(screen!.getByText('Your Google login is no longer valid.')));
  } finally {
    await AsyncStorage.multiRemove(['gromo.locale']);
    applyLocalePref(null);
  }
});
