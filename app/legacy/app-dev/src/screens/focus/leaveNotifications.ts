import * as Notifications from 'expo-notifications';
import { t } from '@/i18n';

// 이탈 로컬 알림 — 세션 중 앱을 벗어나면 예약하고, 복귀하면 취소한다.
// 백그라운드에선 JS가 멈추므로 '나가는 순간' 미리 예약해두는 방식.

let scheduledIds: string[] = [];

// 알림 권한은 푸시 등록(services/push.ts registerPushToken)에서 한 번만 요청한다.
// 여기선 요청하지 않고, 권한이 있으면 예약된 알림이 뜨고 없으면 조용히 무시된다(이탈 감지는 무관하게 동작).

// 이탈 알림 예약: 나가는 즉시 경고 1회 + 자동종료 시점(endSeconds)에 종료 안내 1회.
export async function scheduleLeaveNotifications(
  subjectName: string,
  endSeconds: number,
): Promise<void> {
  await cancelLeaveNotifications();
  const warnId = await Notifications.scheduleNotificationAsync({
    content: {
      title: t('focus.leaveNotification.warnTitle'),
      body: t('focus.leaveNotification.warnBody', { count: endSeconds, subject: subjectName }),
      sound: true,
    },
    // null(즉시)은 백그라운드 전환 직후 포그라운드 발송으로 취급돼 배너가 안 뜨는 경우가 있어
    // 1초 지연으로 발송한다(체감상 즉시).
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      repeats: false,
    },
  });
  const endId = await Notifications.scheduleNotificationAsync({
    content: {
      title: t('focus.leaveNotification.endTitle'),
      body: t('focus.leaveNotification.endBody'),
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: endSeconds,
      repeats: false,
    },
  });
  scheduledIds = [warnId, endId];
}

// 복귀 시 예약 취소 — 이미 발송된 건 무시된다.
export async function cancelLeaveNotifications(): Promise<void> {
  const ids = scheduledIds;
  scheduledIds = [];
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}
