import { NativeModules, Platform } from 'react-native';
import { isMockMode } from '@/services/demoMode';
import { openAirbridgeLink } from '@/services/appDeepLink';

type AirbridgeSDK = typeof import('airbridge-react-native-sdk').Airbridge;
let client: AirbridgeSDK | undefined;
let attributionListener: ((properties: Record<string, string>) => void) | undefined;
let lastAttribution: Record<string, string> | undefined;

/** 설치 귀속은 SDK가 제공한 광고 분류만 전달한다. 기기·이메일 등 식별자를 추가하지 않는다. */
export function onAirbridgeAttribution(
  listener: (properties: Record<string, string>) => void,
): void {
  attributionListener = listener;
  if (lastAttribution) {
    try {
      listener(lastAttribution);
    } catch {}
  }
}

export function normalizeAirbridgeAttribution(
  value: Record<string, string>,
): Record<string, string> | null {
  if (typeof value.attributedChannel !== 'string' || !value.attributedChannel.trim()) return null;
  const fields: Record<string, string> = {
    attributedChannel: 'attributed_channel',
    attributedCampaign: 'attributed_campaign',
    attributedAdGroup: 'attributed_ad_group',
    attributedAdCreative: 'attributed_creative',
  };
  return Object.fromEntries(
    Object.entries(fields).map(([input, output]) => [
      output,
      typeof value[input] === 'string' ? value[input].trim().slice(0, 300) : '',
    ]),
  );
}

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
    // 첫 설치 귀속은 추적 시작 전에 구독한다. 앱 시작과 로그인은 콜백을 기다리지 않는다.
    Airbridge.setOnAttributionReceived((value) => {
      const properties = normalizeAirbridgeAttribution(value);
      if (!properties || JSON.stringify(properties) === JSON.stringify(lastAttribution)) return;
      lastAttribution = properties;
      try {
        attributionListener?.(properties);
      } catch {}
    });
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
): boolean {
  if (!client || isMockMode()) return false;
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
      case 'first_island_arrival':
        // 가입 후 첫 섬 도착(첫 항해 체험) — Google Ads 인앱 액션 전환의 출처(GROMO-2753).
        // Core 플랜은 맞춤 이벤트가 없어 표준 「Complete Tutorial」로 보낸다.
        client.trackEvent('airbridge.completeTutorial', { action: 'first_island_arrival' });
        break;
      default:
        return false;
    }
    return true;
  } catch {
    // 계측 실패가 로그인·집중 완료 처리를 막지 않도록 한다.
    return false;
  }
}
