import { AppState, Platform } from 'react-native';
import { isMockMode } from '@/services/demoMode';
import metaApp from '@/config/metaApp.json';

type MetaSdk = typeof import('react-native-fbsdk-next');
let sdk: MetaSdk | undefined;
let initialization: Promise<boolean> | undefined;
let permissionSync: Promise<void> | undefined;

/** 개발·dev TestFlight·목업에서는 운영 광고 이벤트를 보내지 않는다. */
function enabled(): boolean {
  const environment = process.env.EXPO_PUBLIC_ENV?.trim().toLowerCase();
  return (
    (Platform.OS === 'ios' || Platform.OS === 'android') &&
    !__DEV__ &&
    (!environment || environment === 'prod' || environment === 'production') &&
    process.env.EXPO_PUBLIC_META_ENABLED !== '0' &&
    !isMockMode() &&
    !!metaApp.appId &&
    !!metaApp.clientToken
  );
}

/** Expo의 앱 delegate 구독자가 네이티브 연결을 맡고, 수집은 이 환경 검사 이후에만 켠다. */
export function initMetaSdk(): Promise<boolean> {
  if (!enabled()) return Promise.resolve(false);
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      // 웹과 예전 바이너리에서도 모듈 평가 오류가 앱 부팅을 중단하지 않게 늦춰 읽는다.
      const meta = require('react-native-fbsdk-next') as MetaSdk;
      meta.Settings.setAutoLogAppEventsEnabled(false);
      meta.Settings.setAdvertiserIDCollectionEnabled(false);
      meta.Settings.setAppID(metaApp.appId);
      meta.Settings.setClientToken(metaApp.clientToken);
      meta.Settings.setAppName(metaApp.displayName);
      sdk = meta;
      await syncTrackingPermission(false);
      // 설치·첫 실행 이벤트를 잡도록 초기화 전에 자동 로깅을 켠다.
      meta.Settings.setAutoLogAppEventsEnabled(true);
      meta.Settings.initializeSDK();
      return true;
    } catch {
      sdk = undefined;
      return false;
    }
  })();
  return initialization;
}

async function syncTrackingPermission(request: boolean): Promise<void> {
  if (!sdk) return;
  if (Platform.OS === 'android') {
    sdk.Settings.setAdvertiserIDCollectionEnabled(true);
    return;
  }
  const tracking =
    require('expo-tracking-transparency') as typeof import('expo-tracking-transparency');
  let { status } = await tracking.getTrackingPermissionsAsync();
  if (request && status === 'undetermined' && AppState.currentState === 'active') {
    ({ status } = await tracking.requestTrackingPermissionsAsync());
  }
  const granted = status === 'granted';
  await sdk.Settings.setAdvertiserTrackingEnabled(granted);
  sdk.Settings.setAdvertiserIDCollectionEnabled(granted);
}

/** 첫 전경 실행에서 ATT를 묻고, 설정 앱에서 돌아올 때도 허용 상태를 맞춘다. */
export function syncMetaTracking(): Promise<void> {
  if (permissionSync) return permissionSync;
  permissionSync = (async () => {
    try {
      if (!(await initMetaSdk()) || AppState.currentState !== 'active') return;
      await syncTrackingPermission(true);
    } catch {
      // 권한 조회·광고 SDK 실패가 앱 조작을 막지 않게 한다.
    }
  })().finally(() => {
    permissionSync = undefined;
  });
  return permissionSync;
}

/** 웹·목업은 비활성. 앱이 앞에 있을 때만 ATT를 요청하고 복귀 때 거절·허용 변경을 반영한다. */
export function startMetaTracking(): () => void {
  if (!enabled()) return () => {};
  void syncMetaTracking();
  const subscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') void syncMetaTracking();
  });
  return () => subscription.remove();
}
