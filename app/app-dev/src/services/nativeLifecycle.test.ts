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
function setup() {
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
  };
  const auth = {
    sessionGeneration: jest.fn(() => 1),
    getSession: jest.fn(() => ({ userId: 'owner' })),
  };
  jest.doMock('react-native', () => ({
    Platform: { OS: 'ios' },
    NativeModules: { LiveActivityModule: activity },
  }));
  jest.doMock('./screenTime', () => ({ screenTime: shield }));
  jest.doMock('./api/session', () => auth);
  return {
    activity,
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
});
test('차단 적용 응답이 늦어도 휴식·종료 해제가 마지막에 실행된다', async () => {
  const { shield, focusShield } = setup();
  const pending = deferred();
  shield.startFocusShield.mockReturnValueOnce(pending.promise);
  const start = focusShield.syncFocusShield(focus);
  await Promise.resolve();
  await Promise.resolve();
  const resume = focusShield.syncFocusShield(focus);
  const end = focusShield.syncFocusShield(null);
  pending.resolve(true);
  await Promise.all([start, resume, end]);
  expect(shield.startFocusShield).toHaveBeenCalledTimes(1);
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
test('위젯 저장 도중 로그아웃하면 지우기가 마지막 쓰기다', async () => {
  const { activity, widget } = setup();
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
});
