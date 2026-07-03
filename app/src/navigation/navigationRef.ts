// 알림 탭 → 화면 이동용 네비게이션 ref. 화면 ↔ 네비게이터 순환 import을 피하려 별도 파일로 둔다.
// 앱이 종료 상태에서 알림으로 실행되면 컨테이너가 아직 준비 전일 수 있어, 그때는 링크를 버퍼링했다가
// NavigationContainer onReady(flushPendingDeepLink)에서 흘려보낸다.
import { createNavigationContainerRef } from '@react-navigation/native';
import type { V2RootStackParamList } from '@/navigation/types';

export const navigationRef = createNavigationContainerRef<V2RootStackParamList>();

let pendingLink: string | null = null;

// gromo://<path> 형태의 딥링크를 화면 이동으로 매핑한다.
// 매핑(스펙 GROMO-393): league→리그 탭 / focus→집중 과목선택 / home→홈 탭.
export function navigateToDeepLink(link: string): void {
  if (!navigationRef.isReady()) {
    pendingLink = link; // 컨테이너 준비 전 → 버퍼링
    return;
  }
  const path = link.replace(/^gromo:\/\//, '').split(/[/?#]/)[0];
  switch (path) {
    case 'league':
      navigationRef.navigate('Main', { screen: '리그' } as never);
      break;
    case 'focus':
      navigationRef.navigate('FocusCategory');
      break;
    case 'home':
      navigationRef.navigate('Main', { screen: '홈' } as never);
      break;
    default:
      // 알 수 없는 링크는 무시(홈 유지). TODO: 딥링크 확장 시 케이스 추가.
      break;
  }
}

// NavigationContainer onReady에서 호출 — 준비 전에 도착한 링크를 1회 흘려보낸다.
export function flushPendingDeepLink(): void {
  if (!pendingLink) return;
  const link = pendingLink;
  pendingLink = null;
  navigateToDeepLink(link);
}
