import assert from 'node:assert/strict';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState, reducer, type Route } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';
import {
  cancelBuildingTransition,
  createBuildingTransitionController,
} from '@/services/buildingTransition';

let captured: any;
let mockBootRoute: Route = 'login';

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
  decideBootRoute: async () => mockBootRoute,
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
  mockBootRoute = 'login';
  await AsyncStorage.clear();
  await clearSession();
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
  expect(captured.guideStep).toBe(15);
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
