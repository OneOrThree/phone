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
// ── 전면 오버레이 조정(GROMO-1576) ──────────────────────────────────────────────
// 이 Alert는 터치 없이 비동기 응답으로 뜨는 네이티브 표면이다. 조정자 규칙 B(비동기로 열리는
// 오버레이는 승인받고 마운트)에 따라:
//  · 조정자가 있으면(로그인 트리) `acquire`로 **실제 보유자가 될 때까지** 기다렸다 띄운다 —
//    결과 모달·코치마크·사용자 시트 어떤 보유자든 그 위를 덮지 않는다(코드리뷰). 급하지 않은
//    알림이라 무한정 양보해도 잃는 것이 없다(다음 콜드 스타트에 재확인).
//    ⚠️ 승인 대기 중 게스트→소셜 승격으로 Provider가 교체되면 대기가 영영 안 풀린다 —
//       그때는 이번 실행의 알림을 접는다(놓쳐도 다음 실행에 다시 온다).
//  · 조정자가 없으면(로그인 전 트리) 경쟁 상대가 존재할 수 없으므로 즉시 띄운다.
//  · 표시 중에는 `holdOverlaySlotForNativeSurface`로 점유를 모듈에 들어, 알림이 떠 있는 사이
//    로그인·승격으로 Provider가 서거나 교체돼도 점유가 새 registry에 승계된다
//    (sessionErrors.promptSessionExpired 선례). 같은 id 재등록은 순번 보존 no-op이고,
//    반납(release)은 hold 하나가 registry 등록까지 함께 걷는다.
//  · 반납은 모든 닫힘 경로(두 버튼·onDismiss·앱스토어 열기 실패 안내)에서 — 네이티브 Alert는
//    사용자가 닫아야만 사라지므로 영구 점유가 아니다.
import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import axios from 'axios';
import Constants from 'expo-constants';
import {
  OVERLAY_PRIORITY,
  getOverlaySlotActions,
  holdOverlaySlotForNativeSurface,
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
      // 실제 보유자가 될 때까지 기다린다(헤더 주석) — 조정자가 없으면 경쟁 상대도 없다.
      const actions = getOverlaySlotActions();
      if (actions) {
        const granted = await actions.acquire(UPDATE_ALERT_SLOT_ID, OVERLAY_PRIORITY.updateAlert);
        if (!granted) return;
      }
      // 표시 중 Provider 신설·교체를 견디도록 점유를 모듈에 든다(헤더 주석).
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
      Alert.alert(
        '업데이트 알림',
        '새 버전이 나왔어요! 업데이트하고 이용해 주세요.',
        [
          { text: '나중에', style: 'cancel', onPress: release },
          {
            text: '업데이트',
            onPress: () => {
              // 스크린타임 앱스토어 제한 등으로 열기가 거부될 수 있다 — 안내 없이 삼키면
              // 사용자는 업데이트를 못 한 이유를 모른다(MenuScreen.confirmOpenExternal 선례).
              // 자리는 안내 Alert가 닫힐 때 반납한다 — 그 사이 다른 오버레이가 끼지 않게.
              Linking.openURL(storeUrl)
                .then(release)
                .catch(() => {
                  Alert.alert(
                    '알림',
                    '앱스토어를 열 수 없어요. 잠시 후 다시 시도해 주세요.',
                    [{ text: '확인', onPress: release }],
                    { onDismiss: release },
                  );
                });
            },
          },
        ],
        { onDismiss: release },
      );
    })();
  }, []);

  return null;
}
