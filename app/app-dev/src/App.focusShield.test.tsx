import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '@/App';
import {
  clearSession,
  rememberLocalDataOwner,
  saveRefreshedSession,
  saveSession,
  sessionGeneration,
} from '@/services/api/session';
import { syncFocusShield } from '@/services/focusShield';
import { screenTime } from '@/services/screenTime';
import type { ScreenTimeAuthorization } from '@/services/ScreenTimeModule';

let captured: any;
jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    captured = e;
    return null;
  },
}));
jest.mock('@/services/api/auth', () => ({
  checkSession: async () => ({ status: 'offline' }),
  logout: async () => {},
}));
jest.mock('@/services/islandBoot', () => ({ decideBootRoute: async () => 'login' }));
jest.mock('@/services/api/session', () => {
  const actual = jest.requireActual('@/services/api/session');
  return { ...actual, restoreSession: async () => actual.getSession() };
});
jest.mock('@/services/focusShield', () => ({
  ...jest.requireActual('@/services/focusShield'),
  syncFocusShield: jest.fn(),
}));
jest.mock('@/services/screenTime', () => {
  const actual = jest.requireActual('@/services/screenTime');
  return {
    ...actual,
    screenTime: { ...actual.screenTime, getAuthorizationStatus: jest.fn() },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const failureMessage = '앱 차단 상태를 변경하지 못했어요. 다시 확인해 주세요.';
const appStateListeners = new Set<(state: AppStateStatus) => void>();
const sync = jest.mocked(syncFocusShield);
const authorization = jest.mocked(screenTime.getAuthorizationStatus);
const originalAppState = AppState.currentState;
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const emitAppState = (state: AppStateStatus) =>
  act(async () => {
    (AppState as { currentState: AppStateStatus }).currentState = state;
    for (const listener of appStateListeners) listener(state);
  });
const mountSignedIn = async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'shield-owner' });
  await rememberLocalDataOwner('shield-owner');
  const app = await render(<App />);
  await waitFor(() => expect(captured).toBeDefined());
  return app;
};

beforeEach(async () => {
  jest.useFakeTimers();
  await clearSession();
  await AsyncStorage.clear();
  captured = undefined;
  appStateListeners.clear();
  (AppState as { currentState: AppStateStatus }).currentState = 'active';
  sync.mockReset().mockRejectedValue(new Error('OFFLINE'));
  authorization.mockReset().mockResolvedValue('approved');
  jest.mocked(AppState.addEventListener).mockImplementation((_event, listener) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  });
});

afterEach(() => {
  jest.mocked(AppState.addEventListener).mockImplementation(() => ({ remove: jest.fn() }));
  (AppState as { currentState: unknown }).currentState = originalAppState;
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('서버 조회가 회복되면 2초 뒤 자동 재동기화하고 성공 후 재시도를 멈춘다', async () => {
  const app = await mountSignedIn();
  await waitFor(() => expect(app.queryByText(failureMessage)).not.toBeNull());
  const before = sync.mock.calls.length;
  sync.mockResolvedValue(true);
  await advance(1999);
  expect(sync).toHaveBeenCalledTimes(before);
  await advance(1);
  expect(sync).toHaveBeenCalledTimes(before + 1);
  await advance(30000);
  expect(sync).toHaveBeenCalledTimes(before + 1);
  await app.unmount();
});

test('계속 실패하면 재시도 간격을 최대 30초까지 늘리고 토스트를 반복하지 않는다', async () => {
  const app = await mountSignedIn();
  await waitFor(() => expect(app.queryByText(failureMessage)).not.toBeNull());
  let before = sync.mock.calls.length;
  for (const delay of [2000, 4000, 8000, 16000, 30000, 30000]) {
    await advance(delay - 1);
    expect(sync).toHaveBeenCalledTimes(before);
    await advance(1);
    expect(sync).toHaveBeenCalledTimes(++before);
    if (delay > 2000) expect(app.queryByText(failureMessage)).toBeNull();
  }
  await app.unmount();
});

test('권한을 허용하지 않은 계정은 실패와 재시도 중에도 차단 오류 알림을 표시하지 않는다', async () => {
  authorization.mockResolvedValue('denied');
  const app = await mountSignedIn();
  await waitFor(() => expect(sync).toHaveBeenCalled());
  await advance(2000);
  await advance(4000);
  expect(app.queryByText(failureMessage)).toBeNull();
  await app.unmount();
});

test('백그라운드에서는 재시도를 멈추고 복귀하면 즉시 다시 동기화한다', async () => {
  const app = await mountSignedIn();
  await waitFor(() => expect(app.queryByText(failureMessage)).not.toBeNull());
  const before = sync.mock.calls.length;
  await emitAppState('background');
  await advance(30000);
  expect(sync).toHaveBeenCalledTimes(before);
  sync.mockResolvedValue(true);
  await emitAppState('active');
  expect(sync).toHaveBeenCalledTimes(before + 1);
  await app.unmount();
});

test('앱 안에서 권한을 허용하면 세션 변경이나 앱 복귀 없이 차단을 재동기화한다', async () => {
  authorization.mockResolvedValue('denied');
  sync.mockResolvedValue(true);
  const app = await mountSignedIn();
  await waitFor(() => expect(sync).toHaveBeenCalled());
  const before = sync.mock.calls.length;
  authorization.mockResolvedValue('approved');
  await act(async () => captured.dispatch({ type: 'SETTING', key: 'permission', value: true }));
  expect(sync).toHaveBeenCalledTimes(before + 1);
  await app.unmount();
});

test('같은 사용자로 회원 전환하면 유지 중인 집중의 차단을 다시 동기화하고 재시도한다', async () => {
  const app = await mountSignedIn();
  await act(async () =>
    captured.dispatch({
      type: 'SESSION_SYNC',
      session: {
        id: 'focus-1',
        islandId: 'island-1',
        subject: '집중',
        startedAt: Date.now(),
        seconds: 0,
        status: 'active',
        intervals: [],
      },
    }),
  );
  const before = sync.mock.calls.length;
  const generation = sessionGeneration();
  await act(async () => {
    await saveSession({
      accessToken: 'MEMBER_AT',
      refreshToken: 'MEMBER_RT',
      userId: 'shield-owner',
      provider: 'apple',
    });
  });
  expect(sessionGeneration()).toBe(generation + 1);
  expect(captured.state.session).toMatchObject({ id: 'focus-1', status: 'active' });
  expect(sync).toHaveBeenCalledTimes(before + 1);
  sync.mockResolvedValue(true);
  await advance(2000);
  expect(sync).toHaveBeenCalledTimes(before + 2);
  await advance(30000);
  expect(sync).toHaveBeenCalledTimes(before + 2);
  await emitAppState('background');
  await emitAppState('active');
  expect(sync).toHaveBeenCalledTimes(before + 3);
  await app.unmount();
});

test('회원 전환 전의 지연된 실패가 새 인증 세대의 재시도를 변경하지 않는다', async () => {
  sync.mockResolvedValue(true);
  const app = await mountSignedIn();
  let rejectPrevious!: (error: Error) => void;
  sync.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectPrevious = reject;
      }),
  );
  await emitAppState('active');
  const before = sync.mock.calls.length;
  const previousCurrent = sync.mock.calls.at(-1)![3]!;
  sync.mockRejectedValue(new Error('CURRENT_OFFLINE'));
  await act(async () => {
    await saveSession({
      accessToken: 'MEMBER_AT',
      refreshToken: 'MEMBER_RT',
      userId: 'shield-owner',
      provider: 'apple',
    });
  });
  expect(previousCurrent()).toBe(false);
  expect(sync).toHaveBeenCalledTimes(before + 1);
  await act(async () => rejectPrevious(new Error('PREVIOUS_OFFLINE')));
  sync.mockResolvedValue(true);
  await advance(2000);
  expect(sync).toHaveBeenCalledTimes(before + 2);
  await advance(30000);
  expect(sync).toHaveBeenCalledTimes(before + 2);
  await app.unmount();
});

test('같은 인증 세대의 토큰 갱신은 차단 동기화와 재시도 타이머를 재시작하지 않는다', async () => {
  const app = await mountSignedIn();
  const before = sync.mock.calls.length;
  const generation = sessionGeneration();
  await advance(1000);
  await act(async () => {
    await saveRefreshedSession('REFRESHED_AT', 'REFRESHED_RT', generation, 'AT', 'RT');
  });
  expect(sessionGeneration()).toBe(generation);
  expect(sync).toHaveBeenCalledTimes(before);
  sync.mockResolvedValue(true);
  await advance(1000);
  expect(sync).toHaveBeenCalledTimes(before + 1);
  await app.unmount();
});

test('앱 정리 뒤에는 예약한 차단 재시도가 실행되지 않는다', async () => {
  const app = await mountSignedIn();
  await waitFor(() => expect(app.queryByText(failureMessage)).not.toBeNull());
  const before = sync.mock.calls.length;
  await app.unmount();
  await advance(30000);
  expect(sync).toHaveBeenCalledTimes(before);
});

test('복귀 전 요청이 지연돼도 새로 조회하고 이전 실패가 최신 재시도를 바꾸지 않는다', async () => {
  sync.mockResolvedValue(true);
  const app = await mountSignedIn();
  let rejectPrevious!: (error: Error) => void;
  sync.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectPrevious = reject;
      }),
  );
  await emitAppState('active');
  const before = sync.mock.calls.length;
  sync.mockRejectedValue(new Error('CURRENT_OFFLINE'));
  await emitAppState('active');
  expect(sync).toHaveBeenCalledTimes(before + 1);
  sync.mockResolvedValue(true);
  await act(async () => rejectPrevious(new Error('PREVIOUS_OFFLINE')));
  await advance(2000);
  expect(sync).toHaveBeenCalledTimes(before + 2);
  await advance(30000);
  expect(sync).toHaveBeenCalledTimes(before + 2);
  await app.unmount();
});

test.each<ScreenTimeAuthorization | 'error'>([
  'approved',
  'denied',
  'notDetermined',
  'unavailable',
  'error',
])('권한=%s일 때 앱 실행·복귀의 차단 오류 알림은 승인 상태에서만 표시한다', async (status) => {
  if (status === 'error') authorization.mockRejectedValue(new Error('NATIVE_ERROR'));
  else authorization.mockResolvedValue(status);
  const app = await render(<App />);

  try {
    await waitFor(() => expect(sync).toHaveBeenCalled());
    await act(async () => {});
    expect(app.queryByText(failureMessage) !== null).toBe(status === 'approved');

    await act(async () => jest.advanceTimersByTime(2400));
    expect(app.queryByText(failureMessage)).toBeNull();
    sync.mockClear();
    await act(async () => {
      for (const listener of appStateListeners) listener('active');
    });
    expect(sync).toHaveBeenCalled();
    expect(app.queryByText(failureMessage) !== null).toBe(status === 'approved');
  } finally {
    await app.unmount();
  }
});
