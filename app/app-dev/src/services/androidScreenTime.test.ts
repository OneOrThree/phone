import type { Session } from './model';

function setup() {
  jest.resetModules();
  jest.useFakeTimers().setSystemTime(new Date('2026-10-12T02:00:00Z'));
  const native = {
    bindMeasurementOwner: jest.fn().mockResolvedValue(undefined),
    getAndroidMeasurement: jest.fn(),
    syncAndroidFocus: jest.fn().mockResolvedValue(true),
    endAndroidFocus: jest.fn().mockResolvedValue(undefined),
  };
  const auth = {
    getSession: jest.fn(() => ({ userId: 'owner' })),
    sessionGeneration: jest.fn(() => 1),
  };
  const report = jest.fn().mockResolvedValue(undefined);
  const observation = {
    date: '2026-10-11',
    minutes: 72,
    measurementStatus: 'authorized',
    measuredAt: '2026-10-12T02:00:00Z',
  };
  const measurement = {
    owner: 'owner',
    approved: true,
    date: '2026-10-12',
    minutes: 15,
    history: [],
    unconfirmedDays: [],
    observations: [
      observation,
      { ...observation, date: '2026-10-12', minutes: null, measurementStatus: 'pending' },
    ],
  };
  native.getAndroidMeasurement.mockResolvedValue(measurement);
  jest.doMock('./ScreenTimeModule', () => ({ screenTimeNative: native }));
  jest.doMock('./api/session', () => auth);
  jest.doMock('./api/focusSessions', () => ({
    currentFocusSession: jest.fn().mockResolvedValue(null),
  }));
  jest.doMock('./screenTimeReporting', () => ({ reportScreenTime: report }));
  jest.doMock('./liveActivity', () => ({
    REST_AUTO_CLOSE_MS: 3600000,
    buildLiveActivityPayload: (session: Session) => ({
      sessionId: session.id,
      phase: session.status === 'paused' ? 'rest' : 'focus',
      anchorMs: session.startedAt,
    }),
  }));
  return {
    native,
    auth,
    report,
    measurement,
    mod: require('./androidScreenTime') as typeof import('./androidScreenTime'),
  };
}
afterEach(() => {
  jest.useRealTimers();
});

test('KST 화면 합계 대신 네이티브가 UTC 구간으로 집계한 관측을 보고한다', async () => {
  const { mod, report, measurement } = setup();
  const result = await mod.syncAndroidMeasurement();
  expect(result.minutes).toBe(15);
  expect(report).toHaveBeenCalledWith('approved', null, 1, Date.now(), measurement.observations);
  expect(report.mock.calls[0][4][0].minutes).toBe(72);
});
test('전송 실패가 성공한 로컬 측정값을 지우지 않는다', async () => {
  const { mod, report } = setup();
  report.mockRejectedValue(new Error('OFFLINE'));
  await expect(mod.syncAndroidMeasurement()).resolves.toMatchObject({
    minutes: 15,
    reportFailed: true,
  });
});
test('조회 도중 계정이 바뀌면 이전 계정 기록을 보고하지 않는다', async () => {
  const { mod, native, auth, report, measurement } = setup();
  native.getAndroidMeasurement.mockImplementation(async () => {
    auth.sessionGeneration.mockReturnValue(2);
    return measurement;
  });
  await expect(mod.syncAndroidMeasurement()).rejects.toThrow('STALE_ACCOUNT');
  expect(report).not.toHaveBeenCalled();
});
test.each(['current-number', 'negative', 'duplicate', 'future-time'])(
  '%s 잘못된 관측은 서버로 보내지 않는다',
  async (kind) => {
    const { mod, measurement, report } = setup();
    if (kind === 'current-number')
      Object.assign(measurement.observations[1], { minutes: 10, measurementStatus: 'authorized' });
    if (kind === 'negative') measurement.observations[0].minutes = -1;
    if (kind === 'duplicate') measurement.observations[1].date = '2026-10-11';
    if (kind === 'future-time') measurement.observations[0].measuredAt = '2026-10-13T00:00:00Z';
    await expect(mod.syncAndroidMeasurement()).rejects.toThrow('INVALID_ANDROID_OBSERVATION');
    expect(report).not.toHaveBeenCalled();
  },
);
test('집중 적용을 기다리는 동안 종료되면 과거 적용을 폐기한다', async () => {
  const { mod, native } = setup();
  let release!: () => void;
  native.bindMeasurementOwner.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const session = {
    id: 's',
    version: 1,
    status: 'active',
    startedAt: Date.now(),
    seconds: 0,
    subject: '수학',
    islandId: 'i',
  } as Session;
  const start = mod.syncAndroidFocus(session, 'black');
  await Promise.resolve();
  const end = mod.syncAndroidFocus(null, 'black');
  release();
  await Promise.all([start, end]);
  expect(native.syncAndroidFocus).not.toHaveBeenCalled();
  expect(native.endAndroidFocus).toHaveBeenCalledTimes(1);
});
test('휴식 만료 시각은 서버의 휴식 시작으로부터 한 시간이다', async () => {
  const { mod, native } = setup();
  const session = {
    id: 's',
    version: 2,
    status: 'paused',
    restStartedAt: Date.now() - 1000,
    startedAt: 1,
    seconds: 0,
    subject: '수학',
    islandId: 'i',
  } as Session;
  await mod.syncAndroidFocus(session, 'black');
  expect(JSON.parse(native.syncAndroidFocus.mock.calls[0][0])).toMatchObject({
    version: 2,
    owner: 'owner',
    phase: 'rest',
    validUntilMs: session.restStartedAt! + 3600000,
  });
});

test('콜드 스타트에서 서버에 없는 세션은 저장된 값으로 다시 차단하지 않는다', async () => {
  const { mod, native } = setup();
  const session = { id: 'stale', version: 1, status: 'active' } as Session;
  await mod.syncAndroidFocus(session, 'black', true);
  expect(native.syncAndroidFocus).not.toHaveBeenCalled();
  expect(native.endAndroidFocus).toHaveBeenCalledTimes(1);
});

test('네이티브 원장이 다른 계정으로 바뀌면 관측을 보고하지 않는다', async () => {
  const { mod, measurement, report } = setup();
  measurement.owner = 'previous-owner';
  await expect(mod.syncAndroidMeasurement()).rejects.toThrow('STALE_ACCOUNT');
  expect(report).not.toHaveBeenCalled();
});
