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
  require('react-native').Platform.OS = 'android';
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
const focusing = {
  id: 's',
  version: 1,
  status: 'active',
  startedAt: 1,
  seconds: 0,
  subject: '수학',
  islandId: 'i',
} as Session;
const serverFocus = () => ({
  id: 's',
  version: 2,
  status: 'active',
  activeSeconds: 42,
  serverNow: new Date().toISOString(),
  subject: '수학',
  islandId: 'i',
});

test('서버 조회가 지연돼도 종료는 즉시 해제하고 늦은 집중 응답을 버린다', async () => {
  const { mod, native, currentFocusSession } = setup();
  let release!: (value: unknown) => void;
  currentFocusSession.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const start = mod.syncAndroidFocus(focusing, 'black');
  await Promise.resolve();
  await mod.syncAndroidFocus(null, 'black');
  expect(native.endAndroidFocus).toHaveBeenCalledTimes(1);
  release(serverFocus());
  await start;
  expect(native.syncAndroidFocus).not.toHaveBeenCalled();
});
test('휴식은 조회 없이 앱 복귀를 즉시 해제한다', async () => {
  const { mod, native, currentFocusSession } = setup();
  await mod.syncAndroidFocus({ ...focusing, status: 'paused' }, 'black', true);
  expect(native.endAndroidFocus).toHaveBeenCalledTimes(1);
  expect(native.syncAndroidFocus).not.toHaveBeenCalled();
  expect(currentFocusSession).not.toHaveBeenCalled();
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

test('서버 확인 성공만 최대 2분의 단조 시계 임대를 전달한다', async () => {
  const { mod, native, currentFocusSession } = setup();
  currentFocusSession.mockResolvedValue(serverFocus());
  await mod.syncAndroidFocus(focusing, 'black');
  expect(JSON.parse(native.syncAndroidFocus.mock.calls[0][0])).toMatchObject({
    phase: 'focus',
    owner: 'owner',
    version: 2,
    remainingMs: 120_000,
  });
});
test('서버 조회 실패는 이전 복귀 임대도 해제한다', async () => {
  const { mod, native, currentFocusSession } = setup();
  currentFocusSession.mockRejectedValue(new Error('OFFLINE'));
  await expect(mod.syncAndroidFocus(focusing, 'black')).rejects.toThrow('OFFLINE');
  expect(native.endAndroidFocus).toHaveBeenCalledTimes(1);
});
test('서버 확인 중 계정이 바뀌면 새 계정의 임대를 건드리지 않는다', async () => {
  const { mod, native, currentFocusSession, auth } = setup();
  currentFocusSession.mockImplementation(async () => {
    auth.getSession.mockReturnValue({ userId: 'other' });
    return serverFocus();
  });
  await mod.syncAndroidFocus(focusing, 'black');
  expect(native.syncAndroidFocus).not.toHaveBeenCalled();
  expect(native.endAndroidFocus).not.toHaveBeenCalled();
});
test('서버가 다른 세션을 반환하면 화면의 옛 세션으로 복귀를 적용하지 않는다', async () => {
  const { mod, native, currentFocusSession } = setup();
  currentFocusSession.mockResolvedValue({ ...serverFocus(), id: 'other' });
  await mod.syncAndroidFocus(focusing, 'black');
  expect(native.syncAndroidFocus).not.toHaveBeenCalled();
  expect(native.endAndroidFocus).toHaveBeenCalledTimes(1);
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
