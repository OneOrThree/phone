import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import type { LiveFocusSession } from './types';

/**
 * 라이브 레코드에 "실드를 우리가 정상적으로 내렸다"는 표식을 남긴다 (GROMO-1604 코드리뷰).
 *
 * ## 왜 필요한가
 *
 * 세션 화면을 시스템 Back 으로 빠져나가면 **레코드를 일부러 남긴다** — 그 시점까지의 집중
 * 시간은 다음 실행의 고아 정산이 적립한다. 그래서 "레코드가 남아 있다"는 사실만으로는
 * 강제 종료를 뜻하지 않는데, 고아 정산은 그걸 근거로 "앱이 종료되면서 다른 앱 차단도 함께
 * 풀렸어요"를 띄웠다. **정상적으로 나갔고 실드도 정상 해제됐는데** 나가는 알림이다.
 *
 * 이 표식이 있으면 알림을 건너뛴다. 프로세스가 실제로 죽었다면 이 코드가 돌 기회 자체가
 * 없으므로 표식도 없다 — 그게 판별 근거다.
 *
 * ## 실패를 삼키는 이유
 *
 * 표식을 못 남기면 다음 실행에서 알림이 한 번 더 뜨는 것뿐이다. 화면을 떠나는 경로를
 * 붙잡아 둘 이유가 없다.
 */
export async function markShieldReleasedCleanly(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
    if (!raw) return; // 정상 완료(finish)라 이미 지워졌다 — 남길 곳이 없다.
    const rec = JSON.parse(raw) as LiveFocusSession;
    await AsyncStorage.setItem(
      STORAGE_KEYS.focusLiveSession,
      JSON.stringify({ ...rec, shieldReleasedCleanly: true }),
    );
  } catch {
    // 위 주석 참고 — 최악이 '알림 1회 오발행'이라 조용히 넘어간다.
  }
}

/**
 * 이 세션에 실드가 실제로 걸렸는지를 레코드에 남긴다 (GROMO-1604 코드리뷰 2차).
 *
 * 권한이 없어 `startFocusShield()` 가 처음부터 false 였던 세션은 **풀릴 차단이 없다.**
 * 그런 세션이 강제 종료돼도 "앱이 종료되면서 다른 앱 차단도 함께 풀렸어요"는 거짓이다.
 * 고아 정산이 이 값을 보고 알림 여부를 가른다.
 *
 * 세션 도중에도 바뀔 수 있다 — 복귀 시 생존 확인이 false 를 주면 그때 다시 기록된다.
 */
export async function markShieldActive(active: boolean): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
    if (!raw) return; // 아직 첫 저장 전이거나 이미 정산돼 지워졌다.
    const rec = JSON.parse(raw) as LiveFocusSession;
    if (rec.shieldActive === active) return; // 같은 값이면 쓰지 않는다.
    await AsyncStorage.setItem(
      STORAGE_KEYS.focusLiveSession,
      JSON.stringify({ ...rec, shieldActive: active }),
    );
  } catch {
    // 위와 같은 이유로 삼킨다.
  }
}
