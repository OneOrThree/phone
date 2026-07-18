import * as Notifications from 'expo-notifications';

// 종료·경계 로컬 알림(GROMO-864)의 잔류 예약 정리 전용 모듈.
// 예약 함수들(카운트다운 완료·뽀모도로 경계 체인·휴식 끝)은 제거했다(코덱스 리뷰) — 백그라운드
// 진입 시 저장하는 고아 세션 레코드에 남은 타이머/페이즈가 없어 프로세스가 죽으면 완료를 복구할
// 수 없고, 복구 못 할 완료 알림은 보내지 않기로 하면서 호출부가 사라져 죽은 코드였기 때문.
// 예약을 되살리려면 라이브 레코드에 타이머 상태(남은 시간·페이즈·세트)를 저장하는 작업이 선행돼야 한다.

// 과거 빌드가 예약한 알림 식별 태그 — 프로세스 재시작 후 잔류 예약 정리 시 구분용
const NOTIFICATION_KIND = 'focus-session-boundary';

// 앱 시작 시 잔류 예약 정리 — 세션 중 프로세스가 죽으면 OS에 남은 예약을 취소할 길이 없으므로,
// kind 태그로 이 모듈 예약만 골라 걷어낸다.
// 죽은 세션의 실드를 해제하는 OrphanFocusSettler와 같은 자리에서 호출된다.
export async function cancelStaleCompletionNotifications(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => n.content.data?.kind === NOTIFICATION_KIND)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}
