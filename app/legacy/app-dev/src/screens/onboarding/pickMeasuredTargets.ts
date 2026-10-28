import { Platform } from 'react-native';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { registerUsageBucketMonitoring } from '@/services/screentimeSync';

/**
 * 온보딩에서 측정 대상을 확정하고 측정을 시작한다 (GROMO-1593 코드리뷰).
 *
 * ## 왜 공용 함수인가
 *
 * 권한 요청 스텝과 거부 후 재승인 스텝이 **같은 코드를 각자 들고 있었고**, 둘 다 iOS 전용
 * `presentAppPicker()` 를 불렀다. 안드로이드에서는 그 래퍼가 `null` 을 돌려주므로
 * `if (counts)` 안이 통째로 건너뛰어진다 — 즉 **`registerUsageBucketMonitoring` 도 안 불린다.**
 * 피커가 안 뜨는 것보다 이쪽이 무겁다: 등록 마커와 측정 시작일 앵커가 안 남아, 온보딩을
 * 마쳐도 측정이 시작되지 않는다.
 *
 * ## 플랫폼별로 무엇이 다른가
 *
 * - **iOS**: 시스템 피커를 띄운다. 토큰이 opaque 라 선택을 받아야만 측정 대상이 정해진다.
 *   취소하면 미설정으로 남고, 그건 '측정 안 함'이다.
 * - **Android**: 측정 대상 미설정이 곧 **전체 앱 측정**이다(`getSelectionPackages` 주석 참고).
 *   그래서 온보딩에서 고르지 않아도 측정이 성립한다. 대상을 좁히는 건 「전체」 탭의
 *   측정 대상 화면에서 언제든 할 수 있다.
 *
 * 안드로이드에서 온보딩 중에 RN 피커를 띄우려면 인증 전 내비게이터에 그 화면을 등록해야
 * 하는데, 그건 온보딩 흐름 자체를 바꾸는 일이라 이 PR 범위 밖으로 둔다. 여기서는 **측정이
 * 실제로 시작되게** 하는 것까지만 한다.
 *
 * @returns 측정 대상 설정이 확정됐는가(= `screenTimeSelectionConfigured` 로 기록할 값)
 */
export async function pickMeasuredTargets(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      // 고르는 단계 없이 곧장 등록 — 미설정 = 전체 앱 측정이라 이 상태로 측정이 성립한다.
      await registerUsageBucketMonitoring(null);
      return true;
    }
    const counts = await ScreenTimeModule.presentAppPicker();
    if (!counts) return false; // 취소 — 미설정으로 진행(홈 사용시간 표시가 제한될 수 있다)
    await ScreenTimeModule.promoteSelection();
    // threshold 이벤트는 등록 시점 selection 토큰으로 고정 — 선택 확정 직후 등록해야
    // 사용량 측정·서버 동기화가 시작된다(GROMO-633). 소유 미상(null)으로 등록하고,
    // Syncer 첫 실행이 현재 계정으로 귀속시킨다.
    await registerUsageBucketMonitoring(null);
    return true;
  } catch {
    // picker 미지원 환경(시뮬레이터 등)은 조용히 무시 — 온보딩은 계속 진행한다.
    return false;
  }
}
