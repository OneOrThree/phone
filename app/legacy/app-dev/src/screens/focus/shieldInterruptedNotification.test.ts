// 실드 강제 종료 알림 — 안드로이드에서만, 그리고 정산을 막지 않는다.
//
// 여기서 잠그는 두 가지:
//  1) **iOS에서는 띄우지 않는다.** iOS는 ManagedSettingsStore로 OS에 차단을 위임하므로
//     앱이 죽어도 차단이 남는다 — "차단이 풀렸어요"는 iOS에서 거짓말이다.
//  2) **알림 실패가 정산을 깨지 않는다.** 알림 권한이 없는 사용자가 고아 세션을 잃으면
//     부가 기능 하나 때문에 기록이 날아간 것이다.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { notifyShieldInterrupted } from './shieldInterruptedNotification';

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'id'),
}));

const mockSchedule = Notifications.scheduleNotificationAsync as jest.MockedFunction<
  typeof Notifications.scheduleNotificationAsync
>;

const originalPlatformOS = Platform.OS;
const setPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

beforeEach(() => jest.clearAllMocks());
afterEach(() => setPlatform(originalPlatformOS));

test('안드로이드에서는 알린다', async () => {
  setPlatform('android');

  await notifyShieldInterrupted();

  expect(mockSchedule).toHaveBeenCalledTimes(1);
  // 즉시 1회 — 예약이 아니다(예약이면 잔류 정리 대상이 되고 죽은 뒤에도 늦게 뜬다).
  expect(mockSchedule.mock.calls[0][0].trigger).toBeNull();
});

test('iOS에서는 띄우지 않는다 — 앱이 죽어도 OS가 차단을 유지한다', async () => {
  setPlatform('ios');

  await notifyShieldInterrupted();

  expect(mockSchedule).not.toHaveBeenCalled();
});

// 권한이 없으면 expo-notifications가 throw 한다. 그게 호출부(고아 세션 정산)로 새어 나가면
// 알림 하나 때문에 집중 기록이 통째로 유실된다.
test('알림 실패는 삼킨다 — 호출부로 새지 않는다', async () => {
  setPlatform('android');
  mockSchedule.mockRejectedValueOnce(new Error('permission denied'));

  await expect(notifyShieldInterrupted()).resolves.toBeUndefined();
});

// 얼마나 꺼져 있었는지는 알 수 없다 — 마지막 저장 시각과 실제 사망 시각이 다르고, 사용자가
// 언제 다시 열었는지와도 무관하다. 모르는 값을 그럴듯하게 적으면 그게 곧 거짓 안내다.
test('문구에 지속 시간을 적지 않는다', async () => {
  setPlatform('android');

  await notifyShieldInterrupted();

  const body = mockSchedule.mock.calls[0][0].content.body ?? '';
  expect(body).not.toMatch(/\d+\s*(분|시간|초)/);
});
