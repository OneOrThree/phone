jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn(() => null) }));
import type { Session } from './model';

const focus: Session = {
  id: 'focus-1',
  islandId: 'island-1',
  subject: '수학',
  status: 'active',
  startedAt: 1000,
  seconds: 0,
  version: 1,
};
const deferred = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function setup(os = 'ios') {
  jest.resetModules();
  const activity = {
    sync: jest.fn().mockResolvedValue(true),
    endAll: jest.fn().mockResolvedValue(undefined),
    updateHomeWidget: jest.fn().mockResolvedValue(undefined),
  };
  const shield = {
    bindMeasurementOwner: jest.fn().mockResolvedValue(undefined),
    startFocusShield: jest.fn().mockResolvedValue(true),
    stopFocusShield: jest.fn().mockResolvedValue(undefined),
    getAuthorizationStatus: jest.fn().mockResolvedValue('approved'),
  };
  const auth = {
    sessionGeneration: jest.fn(() => 1),
    getSession: jest.fn(() => ({ userId: 'owner' })),
  };
  jest.doMock('react-native', () => ({
    Platform: { OS: os },
    NativeModules: { LiveActivityModule: activity },
  }));
  jest.doMock('expo', () => ({ requireOptionalNativeModule: () => activity }));
  jest.doMock('./screenTime', () => ({ screenTime: shield }));
  jest.doMock('./api/session', () => auth);
  const current = jest.fn().mockResolvedValue(null);
  jest.doMock('./api/focusSessions', () => ({ currentFocusSession: current }));
  return {
    activity,
    current,
    shield,
    auth,
    live: require('./liveActivity') as typeof import('./liveActivity'),
    focusShield: require('./focusShield') as typeof import('./focusShield'),
    widget: require('./iosHomeWidget') as typeof import('./iosHomeWidget'),
  };
}
afterEach(() => {
  jest.dontMock('react-native');
  jest.dontMock('./screenTime');
  jest.dontMock('./api/session');
  jest.dontMock('./api/focusSessions');
});
test('차단 적용 응답이 늦어도 휴식·종료 해제가 마지막에 실행된다', async () => {
  const { shield, focusShield } = setup();
  const pending = deferred();
  const applying = deferred();
  shield.startFocusShield.mockImplementationOnce(() => {
    applying.resolve(true);
    return pending.promise;
  });
  const start = focusShield.syncFocusShield(focus, 'calico');
  await applying.promise;
  const resume = focusShield.syncFocusShield(focus);
  const end = focusShield.syncFocusShield(null);
  pending.resolve(true);
  await Promise.all([start, resume, end]);
  expect(shield.startFocusShield).toHaveBeenCalledTimes(1);
  expect(shield.startFocusShield).toHaveBeenCalledWith('수학', 'calico');
  expect(shield.stopFocusShield).toHaveBeenCalledTimes(1);
});
test('Activity 종료 요청 뒤 대기 중인 갱신과 같은 세션의 늦은 갱신을 폐기한다', async () => {
  const { activity, live } = setup();
  const pending = deferred();
  activity.sync.mockReturnValueOnce(pending.promise);
  const start = live.syncLiveActivity(focus, 'black');
  await Promise.resolve();
  const rest = live.syncLiveActivity({ ...focus, version: 2, status: 'paused' }, 'black');
  const end = live.endLiveActivities();
  pending.resolve(true);
  await Promise.all([start, rest, end]);
  await live.syncLiveActivity(focus, 'black');
  expect(activity.sync).toHaveBeenCalledTimes(1);
  expect(activity.endAll).toHaveBeenCalledTimes(1);
  await live.syncLiveActivity({ ...focus, id: 'new-session' }, 'black');
  expect(activity.sync).toHaveBeenCalledTimes(2);
});
test('Activity의 이전 버전과 계정 세대가 지난 대기 작업은 적용하지 않는다', async () => {
  const { activity, live, auth } = setup();
  await live.syncLiveActivity({ ...focus, version: 3 }, 'black');
  await live.syncLiveActivity({ ...focus, version: 2 }, 'black');
  const stale = live.syncLiveActivity({ ...focus, version: 4 }, 'black');
  auth.sessionGeneration.mockReturnValue(2);
  await stale;
  expect(activity.sync).toHaveBeenCalledTimes(1);
});
test.each(['ios', 'android'])(
  '%s 위젯 저장 도중 로그아웃하면 지우기가 마지막 쓰기다',
  async (os) => {
    const { activity, widget } = setup(os);
    const pending = deferred();
    activity.updateHomeWidget.mockReturnValueOnce(pending.promise);
    const first = widget.updateIOSHomeWidget({
      owner: 'owner',
      day: '2026-10-08',
      totalSeconds: 120,
      catColor: 'black',
      observedAt: 1000,
    });
    await Promise.resolve();
    const clear = widget.updateIOSHomeWidget(null);
    pending.resolve(true);
    await Promise.all([first, clear]);
    expect(activity.updateHomeWidget.mock.calls.at(-1)).toEqual([null]);
  },
);

test.each([null, { status: 'paused', subject: '서버 휴식' }])(
  'iOS 복귀 시 서버가 %s이면 저장된 active 차단을 해제한다',
  async (server) => {
    const { shield, current, focusShield } = setup();
    current.mockResolvedValue(server);
    await focusShield.syncFocusShield(focus, 'black', true);
    expect(current).toHaveBeenCalledTimes(1);
    expect(shield.startFocusShield).not.toHaveBeenCalled();
    expect(shield.stopFocusShield).toHaveBeenCalledTimes(1);
  },
);
test('iOS는 서버에서 확인한 과목으로만 차단하고 조회 실패 시 기존 차단을 해제한다', async () => {
  const { shield, current, focusShield } = setup();
  current.mockResolvedValue({ status: 'active', subject: '영어' });
  await focusShield.syncFocusShield(focus, 'calico', true);
  expect(shield.startFocusShield).toHaveBeenCalledWith('영어', 'calico');
  current.mockRejectedValue(new Error('OFFLINE'));
  await expect(focusShield.syncFocusShield(focus, 'calico', true)).rejects.toThrow('OFFLINE');
  expect(shield.startFocusShield).toHaveBeenCalledTimes(1);
  expect(shield.stopFocusShield).toHaveBeenCalledTimes(1);
  current.mockResolvedValue({ status: 'active', subject: '복구한 집중' });
  await expect(focusShield.syncFocusShield(focus, 'calico', true)).resolves.toBe(true);
  expect(shield.startFocusShield).toHaveBeenLastCalledWith('복구한 집중', 'calico');
  expect(shield.startFocusShield).toHaveBeenCalledTimes(2);
});
test('iOS 서버 확인 중 계정이 바뀌면 이전 응답으로 차단하지 않는다', async () => {
  const { shield, current, focusShield, auth } = setup();
  current.mockImplementation(async () => {
    auth.sessionGeneration.mockReturnValue(2);
    return { status: 'active', subject: '과거 계정' };
  });
  await focusShield.syncFocusShield(focus, 'black', true);
  expect(shield.startFocusShield).not.toHaveBeenCalled();
  expect(shield.stopFocusShield).not.toHaveBeenCalled();
});

test.each([
  ['approved', true],
  ['denied', false],
  ['notDetermined', false],
  ['unavailable', false],
])('차단 실패 알림은 스크린타임 권한이 %s 일 때 %s', async (status, expected) => {
  const { focusShield, shield } = setup();
  shield.getAuthorizationStatus.mockResolvedValue(status);
  await expect(focusShield.shouldReportShieldFailure()).resolves.toBe(expected);
});

test('권한 조회가 실패하면 차단 실패를 알리지 않는다', async () => {
  const { focusShield, shield } = setup();
  shield.getAuthorizationStatus.mockRejectedValue(new Error('native'));
  await expect(focusShield.shouldReportShieldFailure()).resolves.toBe(false);
});

test.each([null, { ...focus, status: 'paused' as const, version: 2 }])(
  '서버 조회 중에도 휴식·종료(%s)는 차단을 즉시 해제하고 늦은 활성 응답을 버린다',
  async (next) => {
    const { shield, current, focusShield } = setup();
    const reading = deferred();
    const pending = deferred();
    current.mockImplementationOnce(async () => {
      reading.resolve(true);
      await pending.promise;
      return { status: 'active', subject: '오래된 집중' };
    });
    const start = focusShield.syncFocusShield(focus, 'black', true);
    await reading.promise;
    await focusShield.syncFocusShield(next, 'black', true);
    expect(shield.stopFocusShield).toHaveBeenCalledTimes(1);
    expect(shield.startFocusShield).not.toHaveBeenCalled();
    pending.resolve(true);
    await start;
    expect(shield.startFocusShield).not.toHaveBeenCalled();
  },
);

test.each([null, { ...focus, status: 'paused' as const, version: 2 }])(
  '휴식·종료(%s)는 자기 서버 재조회 응답보다 먼저 차단을 해제한다',
  async (next) => {
    const { shield, current, focusShield } = setup();
    const reading = deferred();
    const pending = deferred();
    current.mockImplementationOnce(async () => {
      reading.resolve(true);
      await pending.promise;
      return null;
    });
    const syncing = focusShield.syncFocusShield(next, 'black', true);
    await reading.promise;
    expect(shield.stopFocusShield).toHaveBeenCalledTimes(1);
    pending.resolve(true);
    await syncing;
  },
);

test.each(['denied', 'notDetermined', 'unavailable'])(
  '권한=%s이면 기존 차단을 해제하고 서버 조회와 차단 적용을 생략한다',
  async (status) => {
    const { shield, current, focusShield } = setup();
    shield.getAuthorizationStatus.mockResolvedValue(status);
    await expect(focusShield.syncFocusShield(focus, 'black', true)).resolves.toBe(true);
    expect(shield.stopFocusShield).toHaveBeenCalledTimes(1);
    expect(shield.startFocusShield).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
  },
);

test('화면 정리 뒤 늦게 온 서버 응답은 차단을 다시 적용하지 않는다', async () => {
  const { shield, current, focusShield } = setup();
  let active = true;
  current.mockImplementationOnce(async () => {
    active = false;
    return { status: 'active', subject: '종료된 화면' };
  });
  await focusShield.syncFocusShield(focus, 'black', true, () => active);
  expect(shield.startFocusShield).not.toHaveBeenCalled();
});
