import {
  getTrackingPermissionsAsync,
  requestTrackingPermissionsAsync,
} from 'expo-tracking-transparency';
import { Settings, AppEventsLogger } from 'react-native-fbsdk-next';

// ATT(앱 추적 투명성) 동의 상태를 Meta SDK에 반영한다 — 미결정이면 시스템 팝업을 1회 띄운다.
// 광고 성과의 개인 단위 매칭 품질을 위한 것으로, 거부해도 앱 동작에는 영향이 없다(SKAN 집계로 대체).
export async function syncAdTracking(): Promise<void> {
  try {
    let { status } = await getTrackingPermissionsAsync();
    if (status === 'undetermined') {
      ({ status } = await requestTrackingPermissionsAsync());
    }
    await Settings.setAdvertiserTrackingEnabled(status === 'granted');
  } catch {
    // 동의 상태 반영 실패가 앱 흐름을 막으면 안 된다 — 다음 실행에서 재시도된다.
  }
}

// 온보딩 완료(신규 가입 확정) 광고 이벤트 — "설치만 많은 소재"와 "실제로 쓰는 유저를
// 데려오는 소재"를 구분하는 근거. App ID/Client Token 미설정 빌드에서는 no-op.
export function logCompleteRegistration(): void {
  try {
    AppEventsLogger.logEvent(AppEventsLogger.AppEvents.CompletedRegistration);
  } catch {
    // 측정 이벤트 실패는 무시한다.
  }
}
