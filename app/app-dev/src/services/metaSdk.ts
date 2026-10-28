import { AppState, NativeModules, Platform } from 'react-native';
import { isMockMode } from '@/services/demoMode';

type MetaAppEventsModule = {
  syncTracking(requestPermission: boolean): Promise<boolean>;
};
let permissionSync: Promise<void> | undefined;

/** Android SDK는 별도 네이티브 연결(2545)이 담당한다. 개발·dev·목업에서는 수집하지 않는다. */
function enabled(): boolean {
  const environment = process.env.EXPO_PUBLIC_ENV?.trim().toLowerCase();
  return (
    Platform.OS === 'ios' &&
    !__DEV__ &&
    (!environment || environment === 'prod' || environment === 'production') &&
    process.env.EXPO_PUBLIC_META_ENABLED !== '0' &&
    !isMockMode()
  );
}

/** 첫 전경 실행에서 ATT를 처리하고, 설정 앱에서 돌아올 때도 허용 상태를 맞춘다. */
export function syncMetaTracking(): Promise<void> {
  if (!enabled() || AppState.currentState !== 'active') return Promise.resolve();
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
  if (!enabled()) return () => {};
  void syncMetaTracking();
  const subscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') void syncMetaTracking();
  });
  return () => subscription.remove();
}
