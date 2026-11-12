import { buildScreenTimeObservations } from './screenTimeWindow';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './api/client';
import { getSession, sessionGeneration } from './api/session';
import { putScreenTime } from './api/screenTime';
import { reportScreenTime } from './screenTimeReporting';
import { screenTimeNative } from './ScreenTimeModule';

jest.mock('./ScreenTimeModule', () => ({
  screenTimeNative: { getMeasurementSelectionCounts: jest.fn() },
}));

jest.mock('./api/session', () => ({ getSession: jest.fn(), sessionGeneration: jest.fn() }));
jest.mock('./api/screenTime', () => ({
  ...jest.requireActual('./api/screenTime'),
  putScreenTime: jest.fn(),
}));
const put = jest.mocked(putScreenTime);
const getSelection = jest.mocked(screenTimeNative!.getMeasurementSelectionCounts!);
const selected = { applications: 2, categories: 0, webDomains: 0 };
const sid = '12345678-1234-4234-8234-123456789abc';
const session = {
  userId: 'owner-a',
  accessToken: `header.${btoa(JSON.stringify({ sid }))}.sig`,
  refreshToken: 'refresh',
};
const now = Date.parse('2026-10-08T13:00:00Z');

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(getSession).mockReturnValue(session);
  jest.mocked(sessionGeneration).mockReturnValue(1);
  getSelection.mockReset().mockResolvedValue(selected);
  put.mockReset().mockResolvedValue({});
});
test.each([
  null,
  { ...selected, applications: 0 },
  { ...selected, applications: 0, pendingSelection: selected },
  { ...selected, applications: 0, allApps: true, pendingSelection: selected },
])('실제 측정 대상이 없으면 숫자와 상태 모두 전송하지 않는다 (%j)', async (selection) => {
  getSelection.mockResolvedValue(selection);
  await reportScreenTime('approved', null, 1, now);
  await reportScreenTime('denied', null, 1, now);
  expect(put).not.toHaveBeenCalled();
});

test.each([undefined, false, true])(
  '측정 앱을 저장한 사용자는 이전 공유 설정(%s)과 무관하게 사용 시간을 전송한다',
  async (enabled) => {
    if (enabled !== undefined)
      await AsyncStorage.setItem(
        `gromo:screenTimeReporting:v1:consent:${session.userId}`,
        JSON.stringify({ version: 1, enabled }),
      );
    const observations = buildScreenTimeObservations('approved', null, now).map((o) => ({
      ...o,
      minutes: 42,
      measurementStatus: 'authorized' as const,
    }));
    await reportScreenTime('approved', null, 1, now, observations);
    expect(put.mock.calls.map(([o]) => o)).toEqual(observations);
  },
);

test('iOS 측정 타임라인도 별도 공유 설정 없이 KST 사용 시간을 전송한다', async () => {
  const startedAt = Date.parse('2026-10-07T15:00:00Z') / 1000;
  await reportScreenTime(
    'approved',
    {
      startedAt,
      observedAt: now / 1000,
      unconfirmedDays: [],
      days: [{ date: '2026-10-08', startedAt, events: [{ bucket: 60, firedAt: now / 1000 - 60 }] }],
    },
    1,
    now,
  );
  expect(put).toHaveBeenCalledWith(
    expect.objectContaining({
      timezone: 'Asia/Seoul',
      date: '2026-10-08',
      minutes: 60,
      measurementStatus: 'authorized',
    }),
    sid,
    expect.any(String),
    1,
  );
});

test('응답 유실 뒤 같은 관측 시각·본문·멱등키로 재시도한다', async () => {
  put.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'offline', 0));
  await expect(reportScreenTime('approved', null, 1, now)).rejects.toThrow('offline');
  const first = put.mock.calls[0];
  await reportScreenTime('approved', null, 1, now + 60000);
  expect(put.mock.calls[1]).toEqual(first);
  await reportScreenTime('approved', null, 1, now + 120000);
  expect(put).toHaveBeenCalledTimes(3);
});
test('OS 권한 해제 후 이전 숫자 보고를 버리고 denied만 전송한다', async () => {
  put.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'offline', 0));
  const observations = buildScreenTimeObservations('approved', null, now).map((o) => ({
    ...o,
    minutes: 42,
    measurementStatus: 'authorized' as const,
  }));
  await reportScreenTime('approved', null, 1, now, observations).catch(() => {});
  await reportScreenTime('denied', null, 1, now + 60000, observations);
  expect(put.mock.calls.slice(1).every(([o]) => o.measurementStatus === 'denied')).toBe(true);
  expect(put.mock.calls[1][0]).toMatchObject({ minutes: null, measurementStatus: 'denied' });
  expect(put.mock.calls[1][2]).not.toBe(put.mock.calls[0][2]);
});
test('계정 세대가 바뀐 조회는 전송하지 않는다', async () => {
  jest.mocked(sessionGeneration).mockReturnValue(2);
  await reportScreenTime('approved', null, 1, now);
  expect(put).not.toHaveBeenCalled();
});
test('측정 앱 조회 중 계정이 바뀌면 이전 계정의 관측을 전송하지 않는다', async () => {
  getSelection.mockImplementationOnce(async () => {
    jest.mocked(getSession).mockReturnValue({ ...session, userId: 'owner-b' });
    return selected;
  });
  await reportScreenTime('approved', null, 1, now);
  expect(put).not.toHaveBeenCalled();
});

test('측정 앱이 없는 새 계정에는 이전 계정의 대기 보고를 적용하지 않는다', async () => {
  put.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'offline', 0));
  await reportScreenTime('approved', null, 1, now).catch(() => {});
  jest.mocked(getSession).mockReturnValue({ ...session, userId: 'owner-b' });
  getSelection.mockResolvedValue(null);
  await reportScreenTime('approved', null, 1, now + 60000);
  expect(put).toHaveBeenCalledTimes(1);
});
test('마감 초과·소유권 오류는 같은 관측을 무한 재시도하지 않는다', async () => {
  put.mockRejectedValueOnce(new ApiError('SCREEN_TIME_OUT_OF_WINDOW', 'closed', 422));
  const observations = buildScreenTimeObservations('approved', null, now);
  await expect(reportScreenTime('approved', null, 1, now, observations)).rejects.toThrow('closed');
  await expect(reportScreenTime('approved', null, 1, now + 60000, observations)).rejects.toThrow(
    '거절',
  );
  expect(put).toHaveBeenCalledTimes(2);
});

test('전날 UTC만 영구 거절되어도 다른 세 관측과 다음 당일 갱신을 전송한다', async () => {
  const time = Date.parse('2026-10-09T02:00:00Z');
  const observations = buildScreenTimeObservations('approved', null, time);
  put.mockRejectedValueOnce(new ApiError('SCREEN_TIME_OUT_OF_WINDOW', 'closed', 422));
  await expect(reportScreenTime('approved', null, 1, time, observations)).rejects.toThrow('closed');
  expect(put).toHaveBeenCalledTimes(4);
  expect(put.mock.calls.map(([o]) => `${o.timezone}|${o.date}`)).toEqual([
    'UTC|2026-10-08',
    'UTC|2026-10-09',
    'Asia/Seoul|2026-10-08',
    'Asia/Seoul|2026-10-09',
  ]);
  put.mockClear();
  await expect(reportScreenTime('approved', null, 1, time + 1000, observations)).rejects.toThrow(
    '거절',
  );
  expect(put).not.toHaveBeenCalled();
  const changed = observations.map((o) =>
    o.timezone === 'UTC' && !o.finalized
      ? {
          ...o,
          minutes: 5,
          measurementStatus: 'authorized' as const,
          measuredAt: new Date(time + 2000).toISOString(),
        }
      : o,
  );
  await expect(reportScreenTime('approved', null, 1, time + 2000, changed)).rejects.toThrow('거절');
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0][0]).toMatchObject({ timezone: 'UTC', date: '2026-10-09', minutes: 5 });
});

test.each(['measuredAt', 'windowStart', 'windowEnd'] as const)(
  '거절 이후 %s가 보정되면 같은 분·상태·최종성도 새 키로 재전송한다',
  async (field) => {
    const time = Date.parse('2026-10-09T02:00:00Z');
    const correct = {
      ...buildScreenTimeObservations('approved', null, time)[0],
      minutes: 75,
      measurementStatus: 'authorized' as const,
    };
    const invalid = {
      ...correct,
      [field]: new Date(Date.parse(correct[field]!) + 3_600_000).toISOString(),
    };
    put.mockRejectedValueOnce(new ApiError('SCREEN_TIME_OUT_OF_WINDOW', 'clock', 422));
    await expect(
      reportScreenTime('approved', null, 1, time + 3_600_000, [invalid]),
    ).rejects.toThrow('clock');
    await expect(reportScreenTime('approved', null, 1, time, [invalid])).rejects.toThrow('거절');
    expect(put).toHaveBeenCalledTimes(1);
    await reportScreenTime('approved', null, 1, time, [correct]);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][0]).toEqual(correct);
    expect(put.mock.calls[1][2]).not.toBe(put.mock.calls[0][2]);
  },
);
