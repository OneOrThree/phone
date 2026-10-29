import * as Application from 'expo-application';
import { Platform } from 'react-native';

export type AnalyticsDeviceProperties = {
  device_id?: string;
  device_id_source?: 'android_id' | 'idfv';
};

const DEVICE_ID_TIMEOUT_MS = 1000;

/** 계정·게스트 ID와 분리된 OS 식별자다. 매 실행 조회하고 로컬 대체 ID는 만들지 않는다. */
export async function readAnalyticsDeviceProperties(): Promise<AnalyticsDeviceProperties> {
  try {
    if (Platform.OS === 'android') {
      const id = Application.getAndroidId()?.trim().toLowerCase();
      return id && /^[0-9a-f]+$/.test(id) && !/^0+$/.test(id)
        ? { device_id: id, device_id_source: 'android_id' }
        : {};
    }
    if (Platform.OS !== 'ios') return {};

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // IDFV는 잠금 상태에서 null일 수 있다. 브리지 지연도 SDK 초기화를 무한히 막지 않는다.
      const id = (
        await Promise.race([
          Application.getIosIdForVendorAsync(),
          new Promise<null>((resolve) => {
            timeout = setTimeout(() => resolve(null), DEVICE_ID_TIMEOUT_MS);
          }),
        ])
      )
        ?.trim()
        .toLowerCase();
      return id &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) &&
        !/^0+$/.test(id.replace(/-/g, ''))
        ? { device_id: id, device_id_source: 'idfv' }
        : {};
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  } catch {
    // 구 바이너리·OS 조회 오류는 앱과 기존 분석을 막지 않는다. 다음 실행에서 다시 조회한다.
    return {};
  }
}
