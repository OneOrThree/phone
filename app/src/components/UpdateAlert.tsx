// 앱스토어 최신 버전 안내 알림(무렌더).
// 애플 lookup API로 스토어 최신 버전을 조회해 현재 버전이 낮으면 Alert로 업데이트를 권한다.
// '나중에'로 넘어갈 수 있는 권장 알림 — 최소 지원 버전 강제 차단은 서버 정책이 생기면 별도로.
// 현재 버전은 번들에 박힌 expoConfig.version — OTA(appVersion 전략)가 같은 네이티브 버전에만
// 번들을 내리고 버전 정합 테스트(nativeReleaseVersion.test.ts)가 네 곳을 고정하므로
// 바이너리 버전과 항상 같다.
//
// ── 마운트 위치: 인증 분기 **밖**(App.tsx ToastProvider 안) ─────────────────────
// 로그인 화면·온보딩에서도 앱 시작 시 확인이 돌아야 한다(코드리뷰). 스토어에서 갓 받은
// 바이너리는 항상 최신이라 온보딩 중 뜰 일은 사실상 없지만, 로그아웃된 재방문 유저는
// 로그인 화면이 유일한 노출 경로다.
//
// ── 전면 오버레이 조정(GROMO-1576) — sessionErrors.promptSessionExpired 선례 ─────
// 이 Alert는 터치 없이 비동기 응답으로 뜨는 네이티브 표면이라, 그냥 띄우면 챌린지 결과
// 모달과 경합한다(Alert 뒤에서 결과가 마운트되며 사용자가 못 본 정산에 seen/ack이 찍힘).
// 그래서 띄우기 전에 자리를 쥔다:
//  · `holdOverlaySlotForNativeSurface` — Provider 없는 로그인 전 트리에서도 동작하고
//    (경쟁 상대가 없어 즉시 표시), 알림이 떠 있는 사이 로그인으로 Provider가 서면 점유가
//    새 registry에 자동 승계된다. acquire(승인 대기)로는 두 경우 다 못 다룬다.
//  · 결과 모달이 **이미 노출 중**이면 `whenNoUserDismissableOverlay()`로 사용자가 닫을
//    때까지만 기다렸다 띄운다. 자리는 그동안에도 쥔 채다 — 결과가 닫힌 직후 다른 오버레이가
//    끼어드는 창을 막는다.
//  · 반납은 두 버튼과 onDismiss 전부에서 — 네이티브 Alert는 사용자가 닫아야만 사라지므로
//    영구 점유가 아니다.
import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import axios from 'axios';
import Constants from 'expo-constants';
import {
  OVERLAY_PRIORITY,
  holdOverlaySlotForNativeSurface,
  whenNoUserDismissableOverlay,
} from '@/store/OverlaySlotContext';

// 외부 공개 API라 JWT 인터셉터가 붙는 api 인스턴스 대신 bare axios를 쓴다
const LOOKUP_URL = 'https://itunes.apple.com/lookup?bundleId=com.oneorthree.gromo&country=kr';

// 알림이 떠 있는 동안 점유할 전면 오버레이 자리의 이름.
const UPDATE_ALERT_SLOT_ID = 'update.recommend';

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
      let store: { version?: string; trackViewUrl?: string } | undefined;
      try {
        const { data } = await axios.get(LOOKUP_URL);
        store = data?.results?.[0];
      } catch {
        // 조회 실패(오프라인 등)는 조용히 넘어간다 — 다음 실행에서 다시 확인
        return;
      }
      if (!store?.version || !store.trackViewUrl || !isOlder(current, store.version)) return;
      const storeUrl = store.trackViewUrl;
      // 자리를 먼저 쥔다 — 결과 모달이 이 Alert 뒤에서 마운트되는 창을 닫는다(헤더 주석).
      const releaseHold = holdOverlaySlotForNativeSurface(
        UPDATE_ALERT_SLOT_ID,
        OVERLAY_PRIORITY.updateAlert,
      );
      let released = false; // 버튼과 onDismiss가 둘 다 불릴 수 있어 멱등으로.
      const release = () => {
        if (released) return;
        released = true;
        releaseHold();
      };
      try {
        // 노출 중인 결과 모달이 있으면 사용자가 닫을 때까지 기다린다 — 그 위를 덮지 않는다.
        await whenNoUserDismissableOverlay();
      } catch {
        release();
        return;
      }
      Alert.alert(
        '업데이트 알림',
        '새 버전이 나왔어요! 업데이트하고 이용해 주세요.',
        [
          { text: '나중에', style: 'cancel', onPress: release },
          {
            text: '업데이트',
            onPress: () => {
              release();
              Linking.openURL(storeUrl);
            },
          },
        ],
        { onDismiss: release },
      );
    })();
  }, []);

  return null;
}
