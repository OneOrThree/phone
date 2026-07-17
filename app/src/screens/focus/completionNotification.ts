import * as Notifications from 'expo-notifications';
import type { PomodoroConfig } from './types';

// 종료·경계 로컬 알림(GROMO-864) — 세션 중 앱을 벗어나면 남은 경계 시각들에 예약하고,
// 복귀하면 취소한다. 백그라운드에선 JS가 멈춰 타이머 경계 순간에 아무것도 못 하므로
// '나가는 순간' 남은 시간만큼 뒤로 미리 예약해두는 방식(이탈 알림과 동일 패턴).

// 이 모듈이 예약한 알림 식별 태그 — 프로세스 재시작 후 잔류 예약 정리 시 구분용(코덱스 리뷰)
const NOTIFICATION_KIND = 'focus-session-boundary';

let scheduledIds: string[] = [];
// 예약 세대 — cancel이 호출될 때마다 증가. 취소 시점에 아직 진행 중이던 예약(레이스)이
// 뒤늦게 완료돼 잔류하는 것을 막는다: 각 예약 체인은 시작 시점 세대를 들고 다니고,
// 세대가 바뀌어 있으면 예약을 생략하거나 방금 예약분을 즉시 회수한다.
let generation = 0;

// 알림 권한은 온보딩(NotificationPermissionStep)에서 한 번만 요청한다.
// 권한이 없으면 예약이 조용히 무시될 뿐 세션 진행에는 영향 없다.

async function schedule(gen: number, title: string, body: string, seconds: number): Promise<void> {
  if (gen !== generation) return; // 이미 취소된 체인 — 예약 생략
  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true, data: { kind: NOTIFICATION_KIND } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, seconds),
      repeats: false,
    },
  });
  if (gen !== generation) {
    // 예약이 OS에 등록되는 사이 취소됨(빠른 복귀 등) — 방금 예약분을 즉시 회수
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    return;
  }
  scheduledIds.push(id);
}

// 새 예약 체인 시작 — 이전 예약을 걷어내고 이 체인이 속한 세대를 돌려준다.
async function beginScheduling(): Promise<number> {
  await cancelCompletionNotifications();
  return generation;
}

// 카운트다운 완료 알림: 타이머 종료 시각(endSeconds 뒤)에 1건.
export async function scheduleCompletionNotification(
  subjectName: string,
  endSeconds: number,
): Promise<void> {
  const gen = await beginScheduling();
  await schedule(
    gen,
    '집중 시간이 다 됐어요!',
    `${subjectName} 집중을 끝까지 해냈어요. 돌아와서 결과를 확인해 보세요!`,
    endSeconds,
  );
}

// 뽀모도로 경계 체인(집중 중 이탈·실드 세션 한정): 남은 휴식 시작/집중 재개/최종 완료를 예약.
// 실드 세션은 나가 있어도 벽시계로 진행(복귀 시 fast-forward)하므로 이탈 시점에 경계 시각이 확정된다.
// maxSeconds(복귀 시 집중 인정 상한)를 넘는 경계는 예약하지 않는다 — fast-forward가 상한까지만
// 전진해 진행이 거기 못 미치므로 거짓 알림이 된다(코덱스 리뷰).
export async function schedulePomodoroChainNotifications(
  subjectName: string,
  state: { display: number; setIndex: number },
  pomo: PomodoroConfig,
  maxSeconds: number,
): Promise<void> {
  const gen = await beginScheduling();
  const entries: { title: string; body: string; seconds: number }[] = [];
  let t = state.display; // 현재 집중 블록이 끝나는 시각(초 뒤)
  let set = state.setIndex;
  while (set < pomo.sets) {
    entries.push({
      title: '휴식 시간이에요!',
      body: `${set}세트 집중을 끝까지 해냈어요. ${pomo.breakMin}분 쉬어 가요.`,
      seconds: t,
    });
    t += pomo.breakMin * 60;
    entries.push({
      title: '다시 집중할 시간이에요!',
      body: `휴식이 끝났어요. ${subjectName} ${set + 1}세트를 이어가요.`,
      seconds: t,
    });
    t += pomo.focusMin * 60;
    set += 1;
  }
  // 마지막 세트 집중 끝 = 세션 완료(트레일링 휴식 없음)
  entries.push({
    title: '집중 시간이 다 됐어요!',
    body: `${subjectName} ${pomo.sets}세트를 모두 마쳤어요. 돌아와서 결과를 확인해 보세요!`,
    seconds: t,
  });
  for (const e of entries) {
    if (e.seconds > maxSeconds) break; // 경계 시각은 단조 증가 — 이후 경계도 전부 상한 밖
    await schedule(gen, e.title, e.body, e.seconds);
  }
}

// 뽀모도로 휴식 중 이탈: 휴식 끝 1건만 — 이후 집중은 복귀 대기(일시정지)라 시각을 예측할 수 없다.
export async function scheduleBreakEndNotification(
  subjectName: string,
  endSeconds: number,
): Promise<void> {
  const gen = await beginScheduling();
  await schedule(
    gen,
    '휴식이 끝났어요!',
    `돌아와서 ${subjectName} 다음 세트를 시작해요.`,
    endSeconds,
  );
}

// 복귀·종료 시 예약 전부 취소 — 이미 발송된 건 무시된다.
export async function cancelCompletionNotifications(): Promise<void> {
  generation += 1; // 진행 중이던 예약 체인 무효화(취소 이후 완료되는 예약의 잔류 방지)
  const ids = scheduledIds;
  scheduledIds = [];
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

// 앱 시작 시 잔류 예약 정리(코덱스 리뷰) — 세션 중 프로세스가 죽으면 scheduledIds가 날아가
// OS에 남은 예약을 취소할 길이 없으므로, kind 태그로 이 모듈 예약만 골라 걷어낸다.
// 죽은 세션의 실드를 해제하는 OrphanFocusSettler와 같은 자리에서 호출된다.
export async function cancelStaleCompletionNotifications(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => n.content.data?.kind === NOTIFICATION_KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}
