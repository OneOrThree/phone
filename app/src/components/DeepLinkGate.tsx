import { useEffect } from 'react';
import { Linking } from 'react-native';
import { navigateToDeepLink } from '@/navigation/navigationRef';

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
        });
    }
    const sub = Linking.addEventListener('url', ({ url }) => navigateToDeepLink(url));
    return () => sub.remove();
  }, []);

  return null;
}
