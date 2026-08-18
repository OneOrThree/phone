// 앱스토어 최신 버전 안내 알림(무렌더).
// 애플 lookup API로 스토어 최신 버전을 조회해 현재 버전이 낮으면 Alert로 업데이트를 권한다.
// '나중에'로 넘어갈 수 있는 권장 알림 — 최소 지원 버전 강제 차단은 서버 정책이 생기면 별도로.
// 현재 버전은 번들에 박힌 expoConfig.version — OTA(appVersion 전략)가 같은 네이티브 버전에만
// 번들을 내리고 버전 정합 테스트(nativeReleaseVersion.test.ts)가 네 곳을 고정하므로
// 바이너리 버전과 항상 같다.
import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import axios from 'axios';
import Constants from 'expo-constants';

// 외부 공개 API라 JWT 인터셉터가 붙는 api 인스턴스 대신 bare axios를 쓴다
const LOOKUP_URL = 'https://itunes.apple.com/lookup?bundleId=com.oneorthree.gromo&country=kr';

// '1.9.0' < '1.10.0' 같은 케이스 때문에 문자열 비교 대신 마디별 숫자 비교
export function isOlder(current: string, latest: string): boolean {
  const a = current.split('.').map(Number);
  const b = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export function UpdateAlert() {
  useEffect(() => {
    // 개발 빌드는 스토어보다 버전이 낮기 마련이라 스킵(소음 방지), E2E는 알럿이 대본을 막으므로 스킵
    if (__DEV__ || process.env.EXPO_PUBLIC_E2E === '1' || Platform.OS !== 'ios') return;
    const current = Constants.expoConfig?.version;
    if (!current) return;
    (async () => {
      try {
        const { data } = await axios.get(LOOKUP_URL);
        const store = data?.results?.[0] as { version?: string; trackViewUrl?: string } | undefined;
        if (!store?.version || !store.trackViewUrl || !isOlder(current, store.version)) return;
        const storeUrl = store.trackViewUrl;
        Alert.alert('업데이트 알림', '새 버전이 나왔어요! 업데이트하고 이용해 주세요.', [
          { text: '나중에', style: 'cancel' },
          { text: '업데이트', onPress: () => Linking.openURL(storeUrl) },
        ]);
      } catch {
        // 조회 실패(오프라인 등)는 조용히 넘어간다 — 다음 실행에서 다시 확인
      }
    })();
  }, []);

  return null;
}
