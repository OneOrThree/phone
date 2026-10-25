import type { Session } from './model';
import { utcDay, windowStart } from './screenTimeWindow';

function setup(now = '2026-10-12T02:00:00Z') {
  jest.resetModules();
  jest.useFakeTimers().setSystemTime(new Date(now));
  const native = {
    supportsFocusShield: undefined as boolean | undefined,
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
  const currentFocusSession = jest.fn().mockResolvedValue(null);
  const measurement = {
    owner: 'owner',
    approved: true,
    date: utcDay(Date.now() + 9 * 60 * 60 * 1000),
    minutes: 15,
    history: [],
    unconfirmedDays: [],
    observations: (['UTC', 'Asia/Seoul'] as const).flatMap((timezone) => {
      const today = utcDay(Date.now() + (timezone === 'Asia/Seoul' ? 9 * 60 * 60 * 1000 : 0));
      return [-1, 0].map((offset) => {
        const date = utcDay(Date.parse(`${today}T00:00:00Z`) + offset * 86400000);
        const start = windowStart(date, timezone);
        return {
          date,
          timezone,
          minutes: offset === -1 ? 72 : 15,
          measurementStatus: 'authorized',
          measuredAt: new Date().toISOString(),
          finalized: offset === -1,
          windowStart: new Date(start).toISOString(),
          windowEnd: new Date(start + 86400000).toISOString(),
        };
      });
    }),
  };
  native.getAndroidMeasurement.mockResolvedValue(measurement);
  jest.doMock('./ScreenTimeModule', () => ({ screenTimeNative: native }));
  jest.doMock('./api/session', () => auth);
  jest.doMock('./api/focusSessions', () => ({
    currentFocusSession,
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
    currentFocusSession,
    measurement,
    mod: require('./androidScreenTime') as typeof import('./androidScreenTime'),
  };
}
afterEach(() => {
  jest.useRealTimers();
});

test('차단 미지원 바이너리는 서버 조회·집중 차단을 생략하고 사용량 보고를 유지한다', async () => {
  const { mod, native, currentFocusSession, report, measurement } = setup();
  native.supportsFocusShield = false;
  await expect(
    mod.syncAndroidFocus({ id: 's', version: 1, status: 'active' } as Session, 'black', true),
  ).resolves.toBe(true);
  await expect(mod.syncAndroidFocus(null, 'black', true)).resolves.toBe(true);
  expect(currentFocusSession).not.toHaveBeenCalled();
  expect(native.bindMeasurementOwner).not.toHaveBeenCalled();
  expect(native.syncAndroidFocus).not.toHaveBeenCalled();
  expect(native.endAndroidFocus).not.toHaveBeenCalled();

  await expect(mod.syncAndroidMeasurement()).resolves.toMatchObject({
    minutes: 15,
    reportFailed: false,
  });
  expect(native.bindMeasurementOwner).toHaveBeenCalledWith('owner');
  expect(native.getAndroidMeasurement).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith('approved', null, 1, Date.now(), measurement.observations);
});

test.each(['2026-10-12T02:00:00Z', '2026-10-12T16:00:00Z'])(
  '%s UTC·KST의 오늘·어제 관측 네 개를 모두 보고한다',
  async (now) => {
    const { mod, report, measurement } = setup(now);
    const result = await mod.syncAndroidMeasurement();
    expect(result.minutes).toBe(15);
    expect(report).toHaveBeenCalledWith('approved', null, 1, Date.now(), measurement.observations);
    expect(report.mock.calls[0][4][0].minutes).toBe(72);
  },
);
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
test.each([
  'wrong-finalized',
  'negative',
  'duplicate',
  'future-time',
  'missing-zone',
  'wrong-window',
  'legacy-two',
])('%s 잘못된 관측은 서버로 보내지 않는다', async (kind) => {
  const { mod, measurement, report } = setup();
  if (kind === 'wrong-finalized') measurement.observations[1].finalized = true;
  if (kind === 'missing-zone') Object.assign(measurement.observations[0], { timezone: undefined });
  if (kind === 'wrong-window')
    measurement.observations[2].windowStart = measurement.observations[0].windowStart;
  if (kind === 'legacy-two') measurement.observations.splice(2);
  if (kind === 'negative') measurement.observations[0].minutes = -1;
  if (kind === 'duplicate') measurement.observations[1].date = '2026-10-11';
  if (kind === 'future-time') measurement.observations[0].measuredAt = '2026-10-13T00:00:00Z';
  await expect(mod.syncAndroidMeasurement()).rejects.toThrow('INVALID_ANDROID_OBSERVATION');
  expect(report).not.toHaveBeenCalled();
});
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

test('브리지 전달 중 자정이 지나도 네이티브 관측 날짜를 유지한다', async () => {
  const { mod, report, native, measurement } = setup('2026-10-12T23:59:59.999Z');
  native.getAndroidMeasurement.mockImplementation(async () => {
    jest.setSystemTime(new Date('2026-10-13T00:00:00.010Z'));
    return measurement;
  });
  await expect(mod.syncAndroidMeasurement()).resolves.toMatchObject({ reportFailed: false });
  expect(report).toHaveBeenCalledWith('approved', null, 1, Date.now(), measurement.observations);
});

test('집중 상태는 8시간을 넘어 유지하되 원격 상태 미수신 시 28일 뒤 만료한다', async () => {
  const { mod, native } = setup();
  await mod.syncAndroidFocus(
    {
      id: 's',
      version: 1,
      status: 'active',
      startedAt: 1,
      seconds: 0,
      subject: '수학',
      islandId: 'i',
    } as Session,
    'black',
  );
  expect(JSON.parse(native.syncAndroidFocus.mock.calls[0][0])).toMatchObject({
    phase: 'focus',
    validUntilMs: Date.now() + 28 * 24 * 60 * 60 * 1000,
  });
});

test('동시 앱 사용 합계가 하루를 넘으면 서버 보고만 1440분으로 정규화한다', async () => {
  const { mod, measurement, report } = setup();
  measurement.observations[0].minutes = 1800;
  measurement.observations[2].minutes = 1600;
  await mod.syncAndroidMeasurement();
  expect(report.mock.calls[0][4].map((o: { minutes: number }) => o.minutes)).toEqual([
    1440, 15, 1440, 15,
  ]);
  expect(measurement.observations[0].minutes).toBe(1800);
});
