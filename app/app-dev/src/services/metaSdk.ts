import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { AppState, Dimensions, NativeModules, PixelRatio, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { isMockMode } from '@/services/demoMode';

type MetaAppEventsModule = {
  syncTracking(requestPermission: boolean): Promise<boolean>;
  metaContext?(): Promise<{ anonId: string; advertiserTrackingEnabled: boolean } | null>;
  logEvent?(name: string, eventId: string): Promise<boolean>;
};
let permissionSync: Promise<void> | undefined;

/**
 * 개발·목업·수집 중지에서는 수집하지 않는다.
 * iOS는 환경 값이 비어 있어도 운영으로 본다. Android release는 토큰만 있으면 dev 서버를 봐도 SDK가 켜지므로
 * 앱 이벤트는 EXPO_PUBLIC_ENV가 명시적으로 prod일 때만 보낸다(Android CI가 prod를 넣는다).
 */
function enabled(): boolean {
  const environment = process.env.EXPO_PUBLIC_ENV?.trim().toLowerCase();
  const prod = environment === 'prod' || environment === 'production';
  return (
    (Platform.OS === 'ios' || Platform.OS === 'android') &&
    !__DEV__ &&
    (prod || (Platform.OS === 'ios' && !environment)) &&
    process.env.EXPO_PUBLIC_META_ENABLED !== '0' &&
    !isMockMode()
  );
}

export type MetaContext = {
  anonId: string;
  advertiserTrackingEnabled: boolean;
  extinfo: string[];
};

/** Meta Conversions API의 앱 extinfo(16칸). 모르는 칸은 ''. */
function buildExtinfo(): string[] {
  const ios = Platform.OS === 'ios';
  const window = Dimensions.get('window');
  const ratio = PixelRatio.get();
  const intl = Intl.DateTimeFormat().resolvedOptions();
  const info = Array<string>(16).fill('');
  info[0] = ios ? 'i2' : 'a2';
  info[1] = Application.applicationId ?? '';
  // Meta 문서 예시 순서: [2] 짧은 버전 = 빌드 번호("771"), [3] 긴 버전 = 표시 버전("Version 7.7.1").
  info[2] = Application.nativeBuildVersion ?? '';
  info[3] = Application.nativeApplicationVersion ?? '';
  info[4] = Device.osVersion ?? String(Platform.Version);
  info[5] = (ios ? Device.modelId : Device.modelName) ?? '';
  info[6] = intl.locale.replace('-', '_');
  info[9] = String(Math.round(window.width * ratio));
  info[10] = String(Math.round(window.height * ratio));
  info[11] = String(ratio);
  info[15] = intl.timeZone ?? '';
  return info;
}

/** 서버가 Meta로 첫 섬 도착 이벤트를 보낼 때 쓰는 매칭 값. 수집 조건이 아니거나 못 얻으면 undefined. */
export async function metaContext(): Promise<MetaContext | undefined> {
  if (!enabled()) return undefined;
  try {
    // iOS는 ATT 허용 여부, Android는 기기 광고 추적 제한 설정(GROMO-2743)을 네이티브가 준다.
    const native =
      Platform.OS === 'ios'
        ? await (
            NativeModules.MetaAppEventsModule as MetaAppEventsModule | undefined
          )?.metaContext?.()
        : await requireOptionalNativeModule<Pick<MetaAppEventsModule, 'metaContext'>>(
            'MetaAppEvents',
          )?.metaContext?.();
    if (!native?.anonId) return undefined;
    // 값이 없으면 허용을 가정하지 않는다.
    return {
      anonId: native.anonId,
      advertiserTrackingEnabled: native.advertiserTrackingEnabled === true,
      extinfo: buildExtinfo(),
    };
  } catch {
    return undefined;
  }
}

/**
 * iOS 맞춤 앱 이벤트를 Meta SDK로 한 번 기록한다(GROMO-2749). 서버 CAPI 와 같은 event_id 라 Meta 가 하나로 합치고,
 * 기기 SDK 기록이라 iOS14+ SKAN·AEM 대상이 된다. Android 는 서버 CAPI 만 쓴다. 기록하지 못하면 false.
 */
export async function logMetaEvent(name: string, eventId: string): Promise<boolean> {
  if (Platform.OS !== 'ios' || !enabled()) return false;
  try {
    const meta = NativeModules.MetaAppEventsModule as MetaAppEventsModule | undefined;
    return (await meta?.logEvent?.(name, eventId)) === true;
  } catch {
    return false;
  }
}

/** 첫 전경 실행에서 ATT를 처리하고, 설정 앱에서 돌아올 때도 허용 상태를 맞춘다. */
export function syncMetaTracking(): Promise<void> {
  if (Platform.OS !== 'ios' || !enabled() || AppState.currentState !== 'active')
    return Promise.resolve();
  if (permissionSync) return permissionSync;
  permissionSync = (async () => {
    try {
      const meta = NativeModules.MetaAppEventsModule as MetaAppEventsModule | undefined;
      // 구 바이너리에서도 브리지 누락이 앱 부팅을 중단하지 않게 한다.
      await meta?.syncTracking(true);
    } catch {
      // 권한·광고 SDK 실패가 앱 조작을 막지 않게 한다. 다음 전경 복귀 때 재시도한다.
    }
  })().finally(() => {
    permissionSync = undefined;
  });
  return permissionSync;
}

export function startMetaTracking(): () => void {
  if (Platform.OS !== 'ios' || !enabled()) return () => {};
  void syncMetaTracking();
  const subscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') void syncMetaTracking();
  });
  return () => subscription.remove();
}
