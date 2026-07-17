import * as Notifications from 'expo-notifications';
import type { PomodoroConfig } from './types';

// 종료·경계 로컬 알림(GROMO-864) — 세션 중 앱을 벗어나면 남은 경계 시각들에 예약하고,
// 복귀하면 취소한다. 백그라운드에선 JS가 멈춰 타이머 경계 순간에 아무것도 못 하므로
// '나가는 순간' 남은 시간만큼 뒤로 미리 예약해두는 방식(이탈 알림과 동일 패턴).

let scheduledIds: string[] = [];

// 알림 권한은 온보딩(NotificationPermissionStep)에서 한 번만 요청한다.
// 권한이 없으면 예약이 조용히 무시될 뿐 세션 진행에는 영향 없다.

async function schedule(title: string, body: string, seconds: number): Promise<void> {
  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, seconds),
      repeats: false,
    },
  });
  scheduledIds.push(id);
}

// 카운트다운 완료 알림: 타이머 종료 시각(endSeconds 뒤)에 1건.
export async function scheduleCompletionNotification(
  subjectName: string,
  endSeconds: number,
): Promise<void> {
  await cancelCompletionNotifications();
  await schedule(
    '집중 시간이 다 됐어요!',
    `${subjectName} 집중을 끝까지 해냈어요. 돌아와서 결과를 확인해 보세요!`,
    endSeconds,
  );
}

// 뽀모도로 경계 체인(집중 중 이탈·실드 세션 한정): 남은 휴식 시작/집중 재개/최종 완료를 전부 예약.
// 실드 세션은 나가 있어도 벽시계로 진행(복귀 시 fast-forward)하므로 이탈 시점에 경계 시각이 확정된다.
export async function schedulePomodoroChainNotifications(
  subjectName: string,
  state: { display: number; setIndex: number },
  pomo: PomodoroConfig,
): Promise<void> {
  await cancelCompletionNotifications();
  let t = state.display; // 현재 집중 블록이 끝나는 시각(초 뒤)
  let set = state.setIndex;
  while (set < pomo.sets) {
    await schedule(
      '휴식 시간이에요!',
      `${set}세트 집중을 끝까지 해냈어요. ${pomo.breakMin}분 쉬어 가요.`,
      t,
    );
    t += pomo.breakMin * 60;
    await schedule(
      '다시 집중할 시간이에요!',
      `휴식이 끝났어요. ${subjectName} ${set + 1}세트를 이어가요.`,
      t,
    );
    t += pomo.focusMin * 60;
    set += 1;
  }
  // 마지막 세트 집중 끝 = 세션 완료(트레일링 휴식 없음)
  await schedule(
    '집중 시간이 다 됐어요!',
    `${subjectName} ${pomo.sets}세트를 모두 마쳤어요. 돌아와서 결과를 확인해 보세요!`,
    t,
  );
}

// 뽀모도로 휴식 중 이탈: 휴식 끝 1건만 — 이후 집중은 복귀 대기(일시정지)라 시각을 예측할 수 없다.
export async function scheduleBreakEndNotification(
  subjectName: string,
  endSeconds: number,
): Promise<void> {
  await cancelCompletionNotifications();
  await schedule('휴식이 끝났어요!', `돌아와서 ${subjectName} 다음 세트를 시작해요.`, endSeconds);
}

// 복귀·종료 시 예약 전부 취소 — 이미 발송된 건 무시된다.
export async function cancelCompletionNotifications(): Promise<void> {
  const ids = scheduledIds;
  scheduledIds = [];
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}
