import assert from 'node:assert/strict';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import { clearSession, saveSession } from '@/services/api/session';
import {
  cancelBuildingTransition,
  createBuildingTransitionController,
} from '@/services/buildingTransition';

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
  await clearSession();
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
