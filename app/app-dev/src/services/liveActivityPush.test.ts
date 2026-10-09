import type { Session } from './model';

const session: Session = {
  id: 'session-1',
  islandId: 'island-1',
  subject: '수학',
  status: 'active',
  startedAt: 1000,
  seconds: 0,
  version: 1,
};
const token = {
  sessionId: session.id,
  activityId: 'activity-1',
  pushToken: 'ab'.repeat(32),
  environment: 'development',
};
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup() {
  jest.resetModules();
  jest.useFakeTimers();
  let tokenListener!: (value: typeof token) => void;
  let appListener!: (value: string) => void;
  const request = jest.fn().mockResolvedValue(undefined);
  const generation = jest.fn(() => 1);
  const native = { getPushTokens: jest.fn().mockResolvedValue([token]) };
  const remove = jest.fn();
  const appState = {
    currentState: 'active',
    addEventListener: jest.fn((_name, listener) => {
      appListener = listener;
      return { remove };
    }),
  };
  jest.doMock('react-native', () => ({
    Platform: { OS: 'ios' },
    AppState: appState,
    NativeModules: { LiveActivityModule: native },
    NativeEventEmitter: jest.fn(() => ({
      addListener: jest.fn((_name, listener) => {
        tokenListener = listener;
        return { remove };
      }),
    })),
  }));
  jest.doMock('./api/client', () => ({ request }));
  jest.doMock('./api/session', () => ({
    sessionGeneration: generation,
    getSession: () => ({ userId: 'owner' }),
  }));
  const { startLiveActivityPushSync } = require('./liveActivityPush');
  let current: Session | null = session;
  const stop = startLiveActivityPushSync(() => ({ session: current, color: 'black' }));
  return {
    request,
    generation,
    native,
    stop,
    remove,
    appState,
    event: (value: typeof token) => tokenListener(value),
    foreground: () => appListener('active'),
    end: () => {
      current = null;
    },
  };
}

afterEach(() => {
  jest.useRealTimers();
  jest.dontMock('react-native');
  jest.dontMock('./api/client');
  jest.dontMock('./api/session');
});

test('기존 토큰을 복구 등록하고 같은 토큰은 중복 전송하지 않으며 회전은 등록한다', async () => {
  const test = setup();
  await settle();
  expect(test.request).toHaveBeenCalledWith('/focus-sessions/session-1/live-activity', {
    method: 'PUT',
    generation: 1,
    body: {
      activityId: token.activityId,
      pushToken: token.pushToken,
      environment: 'development',
      catColor: 'black',
    },
  });
  test.event(token);
  await settle();
  expect(test.request).toHaveBeenCalledTimes(1);
  test.event({ ...token, pushToken: 'cd'.repeat(32) });
  await settle();
  expect(test.request).toHaveBeenCalledTimes(2);
  test.stop();
});

test('실패한 등록은 복귀 시 재시도하고 종료 세션·다른 계정의 늦은 토큰은 버린다', async () => {
  const test = setup();
  test.request.mockRejectedValueOnce(new Error('offline'));
  await settle();
  test.foreground();
  await settle();
  expect(test.request).toHaveBeenCalledTimes(2);
  test.event({ ...token, sessionId: 'other-session', pushToken: 'cd'.repeat(32) });
  test.generation.mockReturnValue(2);
  test.event({ ...token, pushToken: 'ef'.repeat(32) });
  await settle();
  expect(test.request).toHaveBeenCalledTimes(2);
  test.stop();
  expect(test.remove).toHaveBeenCalledTimes(2);
});

test('끝난 세션의 이벤트와 정리 후 조회 응답은 등록하지 않는다', async () => {
  const test = setup();
  test.end();
  await settle();
  expect(test.request).not.toHaveBeenCalled();
  test.stop();
  test.event(token);
  await settle();
  expect(test.request).not.toHaveBeenCalled();
});

test('백그라운드에서는 조회 폴링을 멈춘다', async () => {
  const test = setup();
  await settle();
  test.appState.currentState = 'background';
  jest.advanceTimersByTime(30_000);
  await settle();
  expect(test.native.getPushTokens).toHaveBeenCalledTimes(1);
  test.stop();
});
