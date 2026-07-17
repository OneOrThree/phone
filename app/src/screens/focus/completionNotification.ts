import * as Notifications from 'expo-notifications';

// 완료 로컬 알림(GROMO-864) — 실드 카운트다운 세션 중 앱을 벗어나면 종료 시각에 예약하고,
// 복귀하면 취소한다. 백그라운드에선 JS가 멈춰 타이머 종료 순간에 아무것도 못 하므로
// '나가는 순간' 남은 시간만큼 뒤로 미리 예약해두는 방식(이탈 알림과 동일 패턴).

let scheduledId: string | null = null;

// 알림 권한은 온보딩(NotificationPermissionStep)에서 한 번만 요청한다.
// 권한이 없으면 예약이 조용히 무시될 뿐 세션 진행에는 영향 없다.

// 완료 알림 예약: 타이머 종료 시각(endSeconds 뒤)에 1건.
export async function scheduleCompletionNotification(
  subjectName: string,
  endSeconds: number,
): Promise<void> {
  await cancelCompletionNotification();
  scheduledId = await Notifications.scheduleNotificationAsync({
    content: {
      title: '집중 시간이 다 됐어요!',
      body: `${subjectName} 집중을 끝까지 해냈어요. 돌아와서 결과를 확인해 보세요!`,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, endSeconds),
      repeats: false,
    },
  });
}

// 복귀·종료 시 예약 취소 — 이미 발송된 건 무시된다.
export async function cancelCompletionNotification(): Promise<void> {
  const id = scheduledId;
  scheduledId = null;
  if (id) await Notifications.cancelScheduledNotificationAsync(id);
}
