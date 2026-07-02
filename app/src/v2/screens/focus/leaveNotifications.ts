import * as Notifications from 'expo-notifications';

// 이탈 로컬 알림 — 세션 중 앱을 벗어나면 예약하고, 복귀하면 취소한다.
// 백그라운드에선 JS가 멈추므로 '나가는 순간' 미리 예약해두는 방식.

let scheduledIds: string[] = [];

// 알림 권한 확보 — 세션 시작 시 1회 호출. 거부돼도 이탈 감지 자체는 동작한다.
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

// 이탈 알림 예약: 나가는 즉시 경고 1회 + 자동종료 시점(endSeconds)에 종료 안내 1회.
export async function scheduleLeaveNotifications(
  subjectName: string,
  endSeconds: number,
): Promise<void> {
  await cancelLeaveNotifications();
  const warnId = await Notifications.scheduleNotificationAsync({
    content: {
      title: '집중이 멈췄어! 😢',
      body: `${endSeconds}초 안에 돌아오면 ${subjectName} 집중을 이어갈 수 있어.`,
      sound: true,
    },
    trigger: null, // 즉시 발송
  });
  const endId = await Notifications.scheduleNotificationAsync({
    content: {
      title: '집중 세션이 끝났어',
      body: '여기까지 집중한 시간은 저장해뒀어. 준비되면 다시 시작하자!',
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
