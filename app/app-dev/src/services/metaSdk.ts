import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { AppState, Dimensions, NativeModules, PixelRatio, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { isMockMode } from '@/services/demoMode';

type MetaAppEventsModule = {
  syncTracking(requestPermission: boolean): Promise<boolean>;
  metaContext?(): Promise<{ anonId: string; advertiserTrackingEnabled: boolean } | null>;
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
  info[2] = Application.nativeApplicationVersion ?? '';
  info[3] = Application.nativeBuildVersion ?? '';
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
    if (Platform.OS === 'ios') {
      const meta = NativeModules.MetaAppEventsModule as MetaAppEventsModule | undefined;
      const native = await meta?.metaContext?.();
      if (!native?.anonId) return undefined;
      return { ...native, extinfo: buildExtinfo() };
    }
    const anonId = await requireOptionalNativeModule<{ anonymousId(): Promise<string | null> }>(
      'MetaAppEvents',
    )?.anonymousId();
    return anonId
      ? { anonId, advertiserTrackingEnabled: true, extinfo: buildExtinfo() }
      : undefined;
  } catch {
    return undefined;
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
