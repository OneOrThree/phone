import { useEffect } from 'react';
import { Linking } from 'react-native';
import { navigateToDeepLink } from '@/navigation/navigationRef';
import { runDeferredInviteMatchOnce } from '@/services/deferredInvite';

// 외부 링크 수신(그룹 초대 — docs/app/group-plan.md §6-6). UI가 없는 앱 셸 컴포넌트다.
// expo-linking 없이 RN 내장 Linking으로 충분하다. 실제 매핑(league/focus/home/join)은
// @/navigation/navigationRef가 단독으로 책임진다.
//
// ⚠️ 마운트 위치는 **인증 분기 위**(App.tsx 루트)여야 한다.
//    RootNavigator 안에 두면 로그인 화면·온보딩이 떠 있는 동안(=user 없음)엔 구독자가 없어
//    'url' 이벤트가 그대로 유실되고, 나중에 로그인해도 getInitialURL()은 웜 상태에서 전달된
//    이벤트를 복구하지 않는다 — 로그인 전에 누른 초대 링크가 조용히 죽는다.
//    NavigationContainer가 아직 없어도 navigateToDeepLink가 링크를 버퍼링하고,
//    RootNavigator의 onReady(flushPendingDeepLink)가 준비된 뒤 흘려보낸다.
//
// 콜드 스타트의 getInitialURL()은 **프로세스당 1회만** 소비한다 — 앱이 살아 있는 한 네이티브가
// 같은 초기 URL을 계속 돌려주므로, 재마운트 때마다 부르면 사용자가 이미 닫은 초대가 다시 열린다.
// (푸시의 initialNotificationHandled와 같은 방어 — services/push.ts)
let initialUrlHandled = false;

// 설치 후 초대 복원(deferred deep link, 초대 링크 스펙 §7-5)도 여기서 띄운다.
//
// ⚠️ **초기 URL 판정이 끝난 뒤에** 호출해야 한다. deferredInvite는 "직접 링크가 이미 버퍼에
//    있으면 서버 매치를 건너뛴다"로 레이스를 푸는데, getInitialURL()이 비동기라 App.tsx에서
//    나란히 쏘면 버퍼가 아직 비어 있는 순간에 판정이 돌아 UL로 들어온 확실한 초대를
//    확률적 매치 결과가 덮을 수 있다. 초기 URL의 소유자가 이 컴포넌트이므로 순서도 여기서 잠근다.
//    (fire-and-forget — 앱 진입은 이 요청을 절대 기다리지 않는다.)
function startDeferredInviteMatch(): void {
  runDeferredInviteMatchOnce().catch(() => {
    // 서비스가 이미 모든 실패를 삼키지만, 호출부에서도 unhandled rejection을 만들지 않는다.
  });
}

export function DeepLinkGate(): null {
  useEffect(() => {
    if (!initialUrlHandled) {
      initialUrlHandled = true;
      Linking.getInitialURL()
        .then((url) => {
          if (url) navigateToDeepLink(url);
        })
        .catch(() => {
          // 초기 URL 조회 실패는 무시 — 링크 없이 일반 실행으로 진행.
        })
        .finally(startDeferredInviteMatch);
    } else {
      // 재마운트(계정 전환 등) — 초기 URL은 이미 소비됐다. 서비스 자체가 1회성이라 중복은 무해하다.
      startDeferredInviteMatch();
    }
    const sub = Linking.addEventListener('url', ({ url }) => navigateToDeepLink(url));
    return () => sub.remove();
  }, []);

  return null;
}
