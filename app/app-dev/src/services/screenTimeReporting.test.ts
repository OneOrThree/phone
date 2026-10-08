import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './api/client';
import { getSession, sessionGeneration } from './api/session';
import { putScreenTime } from './api/screenTime';
import { reportScreenTime, setScreenTimeReportingConsent } from './screenTimeReporting';

jest.mock('./api/session', () => ({ getSession: jest.fn(), sessionGeneration: jest.fn() }));
jest.mock('./api/screenTime', () => ({
  ...jest.requireActual('./api/screenTime'),
  putScreenTime: jest.fn(),
}));
const put = jest.mocked(putScreenTime);
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
  put.mockReset().mockResolvedValue({});
});
test('전송 동의 전에는 숫자와 상태 모두 전송하지 않는다', async () => {
  await reportScreenTime('approved', null, 1, now);
  expect(put).not.toHaveBeenCalled();
});
test('응답 유실 뒤 같은 관측 시각·본문·멱등키로 재시도한다', async () => {
  await setScreenTimeReportingConsent(session.userId, true);
  put.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'offline', 0));
  await expect(reportScreenTime('approved', null, 1, now)).rejects.toThrow('offline');
  const first = put.mock.calls[0];
  await reportScreenTime('approved', null, 1, now + 60000);
  expect(put.mock.calls[1]).toEqual(first);
  await reportScreenTime('approved', null, 1, now + 120000);
  expect(put).toHaveBeenCalledTimes(2);
});
test('동의 철회 후 이전 대기 보고를 버리고 denied만 전송한다', async () => {
  await setScreenTimeReportingConsent(session.userId, true);
  put.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'offline', 0));
  await reportScreenTime('approved', null, 1, now).catch(() => {});
  await setScreenTimeReportingConsent(session.userId, false);
  await reportScreenTime('approved', null, 1, now + 60000);
  expect(put.mock.calls[1][0]).toMatchObject({ minutes: null, measurementStatus: 'denied' });
  expect(put.mock.calls[1][2]).not.toBe(put.mock.calls[0][2]);
});
test('계정 세대가 바뀐 조회는 전송하지 않는다', async () => {
  await setScreenTimeReportingConsent(session.userId, true);
  jest.mocked(sessionGeneration).mockReturnValue(2);
  await reportScreenTime('approved', null, 1, now);
  expect(put).not.toHaveBeenCalled();
});
test('이전 계정의 큐와 동의를 새 계정에 적용하지 않는다', async () => {
  await setScreenTimeReportingConsent(session.userId, true);
  put.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'offline', 0));
  await reportScreenTime('approved', null, 1, now).catch(() => {});
  jest.mocked(getSession).mockReturnValue({ ...session, userId: 'owner-b' });
  await reportScreenTime('approved', null, 1, now + 60000);
  expect(put).toHaveBeenCalledTimes(1);
});
test('마감 초과·소유권 오류는 같은 관측을 무한 재시도하지 않는다', async () => {
  await setScreenTimeReportingConsent(session.userId, true);
  put.mockRejectedValueOnce(new ApiError('SCREEN_TIME_OUT_OF_WINDOW', 'closed', 422));
  await expect(reportScreenTime('approved', null, 1, now)).rejects.toThrow('closed');
  await expect(reportScreenTime('approved', null, 1, now + 60000)).rejects.toThrow('거절');
  expect(put).toHaveBeenCalledTimes(1);
});
