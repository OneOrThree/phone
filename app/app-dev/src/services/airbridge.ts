import { NativeModules, Platform } from 'react-native';
import { isMockMode } from '@/services/demoMode';
import { openAirbridgeLink } from '@/services/appDeepLink';

type AirbridgeSDK = typeof import('airbridge-react-native-sdk').Airbridge;
let client: AirbridgeSDK | undefined;

export function initAirbridge(): void {
  if (client || (Platform.OS !== 'android' && Platform.OS !== 'ios') || isMockMode()) return;
  if (__DEV__ && process.env.EXPO_PUBLIC_AIRBRIDGE_DEV_ENABLED !== '1') return;
  // SDK를 포함하지 않은 기존 바이너리·Expo Go에서는 네이티브 모듈을 호출하지 않는다.
  if (!NativeModules.EventInteractor) return;
  try {
    const { Airbridge } =
      require('airbridge-react-native-sdk') as typeof import('airbridge-react-native-sdk');
    // 설치 직후 전달되는 지연 딥링크도 놓치지 않도록 추적 시작 전에 구독한다.
    Airbridge.setOnDeeplinkReceived(openAirbridgeLink);
    Airbridge.startTracking();
    client = Airbridge;
  } catch {
    // 계측 실패가 앱 시작을 막지 않도록 한다.
  }
}

export function identifyAirbridgeUser(userId: string): void {
  try {
    client?.setUserID(userId);
  } catch {}
}

export function resetAirbridgeUser(): void {
  try {
    client?.clearUser();
  } catch {}
}

// catus의 Core 플랜에서 지원하는 표준 이벤트만 보낸다.
export function captureAirbridgeEvent(
  event: string,
  properties?: Record<string, string | number>,
): void {
  if (!client || isMockMode()) return;
  try {
    switch (event) {
      case 'guest_login_completed':
        client.trackEvent('airbridge.user.signin', { action: 'guest' });
        break;
      case 'social_login_completed':
        client.trackEvent('airbridge.user.signin', { action: properties?.provider });
        break;
      case 'member_conversion_completed':
        // 기존 회원으로 계정 전환한 경우도 포함하므로 신규 가입으로 집계하지 않는다.
        client.trackEvent('airbridge.user.signin', {
          action: properties?.provider,
          label: 'member_conversion',
        });
        break;
      case 'focus_completed':
        client.trackEvent(
          'airbridge.unlockAchievement',
          { achievementID: 'focus_completed', score: properties?.earned_fish },
          { duration_seconds: properties?.duration_seconds },
        );
        break;
    }
  } catch {
    // 계측 실패가 로그인·집중 완료 처리를 막지 않도록 한다.
  }
}
