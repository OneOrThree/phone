import * as Notifications from 'expo-notifications';
import { shieldDiesWithApp } from '@/services/screenTimeCapabilities';

// 집중 실드가 강제 종료로 함께 죽었다는 사실을 **다음 실행에서** 알린다.
//
// ## 왜 다음 실행인가 (죽는 순간이 아니라)
// 안드로이드의 force-stop 은 프로세스를 죽이는 데서 끝나지 않고 앱을 **stopped state** 로
// 만든다 — 브로드캐스트도, 알람도, JobScheduler 도 오지 않는다. 사용자가 앱을 직접 열기
// 전까지 **우리 코드는 한 줄도 실행되지 않는다.** 그래서 "죽는 순간 알린다"는 원리상 불가능하고,
// 다음 실행에서 알리는 것이 할 수 있는 전부다.
//
// ## 왜 안드로이드에서만인가
// iOS는 `ManagedSettingsStore` 로 OS에 차단을 위임하므로 **앱이 죽어도 차단은 남는다.**
// 같은 알림을 iOS에서 띄우면 거짓말이 된다(`shieldDiesWithApp` 주석 참고).

const NOTIFICATION_KIND = 'focus-shield-interrupted';

/**
 * 실드가 세션과 함께 죽었음을 알리는 로컬 알림 1건.
 *
 * 고아 세션이 실제로 발견됐을 때만 부른다 — 고아 레코드가 있다는 건 세션 중 프로세스가
 * 죽었다는 뜻이고, 안드로이드에서는 그 순간부터 아무 앱도 안 잠겼다는 뜻이다.
 *
 * **얼마나 꺼져 있었는지는 쓰지 않는다.** 라이브 레코드의 마지막 저장 시각과 실제 사망
 * 시각은 다르고(최대 5초 + 그 뒤 알 수 없는 공백), 사용자가 앱을 언제 다시 열었는지와도
 * 무관하다. 모르는 값을 그럴듯하게 적으면 그게 곧 거짓 안내다.
 *
 * 실패(권한 없음·모듈 이상)는 삼킨다 — 알림 하나 때문에 고아 세션 **정산이 막히면 안 된다.**
 */
export async function notifyShieldInterrupted(): Promise<void> {
  if (!shieldDiesWithApp()) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '집중이 끊겼어요',
        body: '앱이 종료되면서 다른 앱 차단도 함께 풀렸어요. 이어서 집중하려면 다시 시작해 주세요.',
        data: { kind: NOTIFICATION_KIND },
      },
      // null = 즉시. 예약이 아니라 지금 한 번 띄우는 것이라 잔류 정리 대상이 아니다.
      trigger: null,
    });
  } catch {
    /* 권한 없음 등 — 알림은 부가 정보이므로 정산을 막지 않는다 */
  }
}
