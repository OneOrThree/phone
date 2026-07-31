// 알림 탭·초대 링크 → 화면 이동용 네비게이션 ref. 화면 ↔ 네비게이터 순환 import을 피하려 별도 파일로 둔다.
// 앱이 종료 상태에서 알림/링크로 실행되면 컨테이너가 아직 준비 전일 수 있어, 그때는 링크를 버퍼링했다가
// NavigationContainer onReady(flushPendingDeepLink)에서 흘려보낸다.
import { createNavigationContainerRef } from '@react-navigation/native';
import type { V2RootStackParamList } from '@/navigation/types';
import { parseInviteLink } from '@/utils/inviteLink';

export const navigationRef = createNavigationContainerRef<V2RootStackParamList>();

let pendingLink: string | null = null;

// ── 그룹 초대 링크 수신 계약 (docs/app/group-plan.md §6-6) ───────────────────────────
// 초대 프리뷰(GroupInviteSheet)는 **라우트가 아니라 GroupScreen 안의 오버레이**라 navigate()로 띄울 수
// 없다. 그래서 groupId를 여기 모듈 버퍼에 두고, 마운트된 GroupScreen이 리스너로 받아 시트를 연다.
//
// 후속 워커에게(APP-7):
//   1) GroupScreen이 마운트 시 setGroupInviteListener(fn) 등록 + peekPendingInvite()로 초기값을 읽는다.
//      (이미 배선돼 있다 — GroupScreen.tsx의 '초대 링크 수신' 블록)
//   2) 버퍼는 **읽어도 지워지지 않는다**. 게스트가 링크로 들어와 소셜 로그인하면 세션 교체로 앱 트리가
//      리마운트되는데(triggerRelogin), 읽을 때 지우면 그 순간 초대가 증발한다. §6-6/§11의
//      "로그인 후 같은 그룹 프리뷰로 복귀"는 이 버퍼 유지로 만족시킨다.
//   3) 시트를 닫거나 참여가 끝났을 때만 clearPendingInvite()를 부른다 — GroupInviteSheet의 onClose/
//      onJoined가 GroupScreen에서 이미 그렇게 배선돼 있으니, 시트 내부에서 따로 버퍼를 만지지 말 것.
let pendingInviteGroupId: string | null = null;
let inviteListener: ((groupId: string) => void) | null = null;

// 마운트된 GroupScreen이 등록/해제한다. 언마운트 시 반드시 null로 되돌린다.
export function setGroupInviteListener(fn: ((groupId: string) => void) | null): void {
  inviteListener = fn;
}

// 버퍼에 남아 있는 초대 groupId를 '읽기만' 한다(소비하지 않음 — 위 2번 이유).
export function peekPendingInvite(): string | null {
  return pendingInviteGroupId;
}

// 초대 처리가 끝났을 때(시트 닫힘·참여 완료) 버퍼를 비운다.
export function clearPendingInvite(): void {
  pendingInviteGroupId = null;
}

// 링크에서 뽑은 groupId를 버퍼에 넣고, GroupScreen이 이미 떠 있으면 즉시 알린다.
// 화면이 아직 없으면(콜드 스타트·다른 탭) 버퍼가 남아 GroupScreen 마운트 시 peek로 이어받는다.
function notifyGroupInvite(groupId: string): void {
  pendingInviteGroupId = groupId;
  inviteListener?.(groupId);
}

// gromo://<path>?<query> 형태의 딥링크를 화면 이동으로 매핑한다.
// 매핑: league→리그 탭 / focus→집중 과목선택 / home→홈 탭 (스펙 GROMO-393, 푸시가 쓰는 중) +
//       join→그룹 탭 + 초대 프리뷰(§6-6).
export function navigateToDeepLink(link: string): void {
  if (!navigationRef.isReady()) {
    pendingLink = link; // 컨테이너 준비 전 → 버퍼링
    return;
  }
  // 경로만 잘라 쓰되 원본 link는 그대로 넘긴다 — 예전엔 split(/[/?#]/)로 쿼리를 버려서
  // ?g=<uuid>를 읽을 수 없었다(§6-6-2). 파싱 규격의 단일 소스는 @/utils/inviteLink.
  const path = link.replace(/^gromo:\/\//i, '').split(/[/?#]/)[0];
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
    case 'join': {
      // 그룹 초대 링크. 형식이 아니면(잘못된 g·g 없음) 조용히 무시한다 — 크래시·오동작 금지(§11).
      const groupId = parseInviteLink(link);
      if (!groupId) break;
      navigationRef.navigate('Main', { screen: '그룹' } as never);
      notifyGroupInvite(groupId);
      break;
    }
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
