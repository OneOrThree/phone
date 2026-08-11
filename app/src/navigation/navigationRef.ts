// 알림 탭·초대 링크 → 화면 이동용 네비게이션 ref. 화면 ↔ 네비게이터 순환 import을 피하려 별도 파일로 둔다.
// 앱이 종료 상태에서 알림/링크로 실행되면 컨테이너가 아직 준비 전일 수 있어, 그때는 링크를 버퍼링했다가
// NavigationContainer onReady(flushPendingDeepLink)에서 흘려보낸다.
import { createNavigationContainerRef } from '@react-navigation/native';
import type { V2RootStackParamList } from '@/navigation/types';
import { parseInviteLink } from '@/utils/inviteLink';
import { logInviteLinkOpened } from '@/services/analyticsEvents';
import { getMyGroups } from '@/services/groupApi';
import { requestCoinRefresh } from '@/store/coinRefreshSignal';
import {
  clearPendingDirectGroupEntry,
  clearPendingGroupEntry,
  discardInitialGroupRoomReturn,
  markInitialGroupRoomReturn,
  queueDirectGroupEntry,
} from '@/navigation/groupEntrySource';

export const navigationRef = createNavigationContainerRef<V2RootStackParamList>();

let pendingLink: string | null = null;

// 딥링크 요청 세대 — 그룹 링크는 getMyGroups()를 기다렸다 그룹방을 push 한다. 그 사이 다른
// 딥링크가 도착하면 먼저 시작한 조회가 늦게 끝나며 **최신 목적지 위에 옛 방을 다시 연다.**
// navigateToDeepLink 진입마다 올려서, 진행 중인 조회는 자기 세대가 최신일 때만 이동을 완료한다
// (화면들이 쓰는 requestSeqRef와 같은 방식).
let groupLinkSeq = 0;
// 이 모듈이 아직 GroupScreen에 소비되지 않았을 수 있는 direct source를 예약한 세대.
// 후속 딥링크나 지연 push 취소가 해당 source를 폐기할 때 최신 예약을 지우지 않도록 세대와 묶는다.
let pendingGroupEntrySeq: number | null = null;

function discardQueuedGroupEntry(seq?: number): void {
  if (pendingGroupEntrySeq === null) return;
  if (seq !== undefined && pendingGroupEntrySeq !== seq) return;
  clearPendingGroupEntry();
  pendingGroupEntrySeq = null;
}

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
//
// 버퍼가 들고 있는 값(초대 링크 스펙 §7-3):
//   groupId — 초대의 본체. 시트를 여는 대상.
//   slug    — 어트리뷰션 앵커. 구형 링크(§4-1)로 들어오면 null이다.
//   entry   — 'link'(링크로 앱 직행) | 'deferred'(미설치→설치 후 서버 매치로 복원).
//             GA4 6b·join_method 를 가르는 축이라 버퍼가 끝까지 들고 가야 한다.
export interface PendingInvite {
  groupId: string;
  slug: string | null;
  entry: 'link' | 'deferred';
}

let pendingInvite: PendingInvite | null = null;
let inviteListener: ((invite: PendingInvite) => void) | null = null;

// 마운트된 GroupScreen이 등록/해제한다. 언마운트 시 반드시 null로 되돌린다.
export function setGroupInviteListener(fn: ((invite: PendingInvite) => void) | null): void {
  inviteListener = fn;
}

// 버퍼에 남아 있는 초대를 '읽기만' 한다(소비하지 않음 — 위 2번 이유).
export function peekPendingInvite(): PendingInvite | null {
  return pendingInvite;
}

// 초대 처리가 끝났을 때(시트 닫힘·참여 완료) 버퍼를 비운다.
export function clearPendingInvite(): void {
  pendingInvite = null;
}

// 초대를 버퍼에 넣고, GroupScreen이 이미 떠 있으면 즉시 알린다.
// 화면이 아직 없으면(콜드 스타트·다른 탭) 버퍼가 남아 GroupScreen 마운트 시 peek로 이어받는다.
//
// deferred 매치(services/deferredInvite.ts)도 이 함수로 합류한다 — 링크 경로와 같은 체인을
// 타야 "자동 가입 금지, 반드시 시트 확인 경유"(스펙 D3)가 한 곳에서 지켜진다.
export function notifyGroupInvite(invite: PendingInvite): void {
  pendingInvite = invite;
  inviteListener?.(invite);
}

// gromo://<path>?<query> 형태의 딥링크를 화면 이동으로 매핑한다.
// 매핑: league→리그 탭 / focus→집중 과목선택 / home→홈 탭 (스펙 GROMO-393, 푸시가 쓰는 중) +
//       join→그룹 탭 + 초대 프리뷰(§6-6) + group→그룹방(+결과 모달) + friends→친구 추가.
export function navigateToDeepLink(link: string): void {
  if (!navigationRef.isReady()) {
    pendingLink = link; // 컨테이너 준비 전 → 버퍼링
    return;
  }
  // 새 딥링크는 **종류·파라미터 유효성과 무관하게** 진행 중인 그룹 목록 조회를 무효화한다
  // (코덱스 리뷰). 그룹 링크를 탭해 조회가 도는 동안 보관함에서 home·friends나 g가 깨진 링크를
  // 다시 탭하면, 세대를 여기서 올리지 않을 경우 먼저 시작한 조회가 뒤늦게 끝나며 최신 목적지
  // 위에 그룹방을 다시 열어 버린다.
  const seq = ++groupLinkSeq;
  // 새 링크가 도착했다는 사실 자체가 이전 지연 push/invite 전환을 중단한다. 이전 source를
  // 그대로 두면 나중에 사용자가 직접 그룹 탭을 열었을 때 오래된 유입으로 소비된다.
  discardQueuedGroupEntry();

  // 초대 링크 판정은 **파서를 먼저** 태운다 — 파싱 규격의 단일 소스는 @/utils/inviteLink이고,
  // 파서가 받아주는 슬래시 변형(gromo:///join?g=…)을 여기서 경로 문자열로 다시 자르면
  // 첫 세그먼트가 빈 문자열이 되어 'join'에 닿지 못한다.
  const invite = parseInviteLink(link);
  if (invite) {
    // 이미 그룹 화면이 focus된 warm invite는 현재 episode와 다음 source를 바꾸지 않는다.
    // 다른 화면에서 실제 새 focus를 만드는 direct entry만 GroupScreen이 1회 소비한다.
    if (navigationRef.getCurrentRoute?.()?.name !== '그룹') {
      queueDirectGroupEntry('invite');
      pendingGroupEntrySeq = seq;
    }
    navigationRef.navigate('Main', { screen: '그룹' } as never);
    // 6a invite_link_opened(스펙 §4-3) — '링크로 앱이 열렸다'는 사실 자체가 퍼널 단계다.
    // via는 링크 형식으로 가른다: https 프리픽스면 Universal Link, 아니면 랜딩의 스킴 점프.
    // slug는 GA4 파라미터라 null 대신 undefined로 넘겨 sanitize 단계에서 빠지게 한다.
    logInviteLinkOpened({
      group_id: invite.groupId,
      slug: invite.slug ?? undefined,
      via: /^https:/i.test(link.trim()) ? 'universal_link' : 'scheme',
    });
    notifyGroupInvite({ ...invite, entry: 'link' });
    return;
  }

  // 나머지 매핑은 경로만 잘라 쓴다. 선행 슬래시 수는 정규화한다(gromo:///league도 리그로).
  const path = link.replace(/^gromo:\/\/+/i, '').split(/[/?#]/)[0];
  switch (path) {
    case 'league':
      discardInitialGroupRoomReturn();
      navigationRef.navigate('Main', { screen: '리그' } as never);
      break;
    case 'focus':
      navigationRef.navigate('FocusCategory', {
        initialGroupId: undefined,
        entrySource: 'unknown',
        interactionId: undefined,
        interactionAcceptedAt: undefined,
      });
      break;
    case 'home':
      discardInitialGroupRoomReturn();
      navigationRef.navigate('Main', { screen: '홈' } as never);
      break;
    case 'group':
      // 그룹 푸시 딥링크(gromo://group?g={groupId}[&challenge={challengeId}][&result=1][&refund=1]) —
      // 먼저 그룹 탭으로 이동해 두고(조회 실패 폴백), 내 그룹이 맞으면 그룹방을 스택에 push 한다.
      // challenge가 실려 있으면 그룹방이 그 챌린지의 결과 모달을 자동으로 연다(GROMO-1088).
      // result=1(결과성 푸시 — push.ts가 합성)은 멤버십 게이트를 우회한다(아래 pushGroupRoom).
      // refund=1(환불 푸시)은 잔액 재조회를 요청한다 — 삭제 환불은 결과 모달에서 빠지고 챌린지
      // 목록에도 안 남아, 이 표식이 없으면 화면 어느 경로도 잔액을 다시 받지 않는다(codex 리뷰 P2).
      // 그룹방 push 성사 여부와 무관하게 태운다 — 잔액은 그룹 소속과 상관없는 내 재산이다.
      const groupId = readGroupParam(link);
      const resultPush = readResultFlag(link);
      const currentRoute = navigationRef.getCurrentRoute?.()?.name;
      // 결과성 push는 아래에서 목록을 건너뛰므로 다음 GroupScreen episode의 direct source가
      // 아니다. 방을 닫은 뒤의 복귀를 push로 오염시키지 않도록 일반 push에만 예약한다.
      if (!(resultPush && groupId !== null) && currentRoute !== '그룹') {
        queueDirectGroupEntry('push');
        pendingGroupEntrySeq = seq;
      }
      // 결과성 push는 목록 focus 전에 GroupRoom으로 곧바로 우회할 수 있다. 그룹 흐름 밖에서
      // 시작한 우회라면 방을 닫은 뒤 처음 보이는 목록은 탭 진입이 아니라 자식 화면 복귀다.
      if (
        resultPush &&
        groupId !== null &&
        currentRoute !== '그룹' &&
        currentRoute !== 'GroupRoom'
      ) {
        markInitialGroupRoomReturn();
      }
      if (readRefundFlag(link)) requestCoinRefresh();
      navigateToGroup(seq, groupId, readChallengeParam(link), resultPush);
      break;
    case 'friends':
      // 친구 요청/수락 푸시(gromo://friends) — 친구 추가 화면으로 보낸다(티켓 1090이 발행).
      navigationRef.navigate('FriendAdd');
      break;
    default:
      // 알 수 없는 링크와 형식이 깨진 초대 링크(잘못된 g·g 없음)는 조용히 무시한다(§11).
      // TODO: 딥링크 확장 시 케이스 추가.
      break;
  }
}

// UUID 파라미터를 링크에서 잘라낸다 — 뒤에 다른 파라미터가 이어져도(`…&challenge=…`)
// 룩어헤드 `(?=[&#]|$)`가 값의 끝을 고정해 준다. 형식이 어긋나면 null.
function readUuidParam(link: string, name: string): string | null {
  const m = new RegExp(
    `[?&]${name}=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=[&#]|$)`,
    'i',
  ).exec(link);
  return m ? m[1] : null;
}

// 그룹 딥링크의 g 파라미터(UUID) — 형식이 어긋나면 null(그룹 탭 이동만 하고 끝낸다).
function readGroupParam(link: string): string | null {
  return readUuidParam(link, 'g');
}

// 챌린지 종료 푸시의 challenge 파라미터(UUID, 계약 §2) — 결과 모달을 열 대상이다.
// 없거나 형식이 어긋나면 null: 모달 없이 그룹방까지만 간다(기존 동작 유지).
function readChallengeParam(link: string): string | null {
  return readUuidParam(link, 'challenge');
}

// 결과성 푸시 표식(result=1 — push.ts RESULT_PUSH_TYPES가 합성) — 정산 결과·환불 통지는 참가자
// 스코프 사건이라(N53·C8) 탈퇴자에게도 도달해야 한다. 이 표식이 있으면 아래 pushGroupRoom이
// 멤버십 게이트를 우회한다.
function readResultFlag(link: string): boolean {
  return /[?&]result=1(?=[&#]|$)/i.test(link);
}

// 환불 푸시 표식(refund=1 — push.ts REFUND_PUSH_TYPES가 합성) — 이 링크로 열린 진입에서
// 잔액을 다시 받는다. 삭제 환불은 결과 모달 대상에서 제외되고(challengeResult.ts의
// voidReason 필터) 그룹의 챌린지 목록에서도 사라져, GroupRoomScreen의 refreshCoins 경로가
// 하나도 발화하지 않는다 — 환불 전 잔액이 앱이 살아 있는 내내 남는다(codex 리뷰 P2).
function readRefundFlag(link: string): boolean {
  return /[?&]refund=1(?=[&#]|$)/i.test(link);
}

// 그룹 푸시의 그룹 화면 진입 — GroupScreen의 목록 카드 탭(onSelectGroup)과 **같은 분기**를 쓴다:
// A-9(3차) 이후 소속이 1개든 여러 개든 그룹 탭의 기본 화면은 목록이고, 그룹방은 라우트 push로만
// 열린다(내장 렌더 폐지 — GroupScreen.tsx §A-9 주석). 그래서 소속 수를 보지 않고 push 한다.
// 내 그룹인지는 확인한다 — 목록을 직접 받아, 조회가 실패하거나 내 그룹이 아니면(푸시 수신 후
// 탈퇴 등) 이미 이동해 둔 그룹 탭이 폴백이다.
// 그룹방 진입 자체가 재조회를 트리거해(useFocusEffect) 챌린지 결과 모달로 이어진다(A3).
function navigateToGroup(
  seq: number,
  groupId: string | null,
  challengeId: string | null,
  resultPush: boolean,
): void {
  navigationRef.navigate('Main', { screen: '그룹' } as never);
  if (!groupId) {
    discardQueuedGroupEntry(seq);
    return;
  }
  // 목록 조회 실패는 삼킨다 — 그룹 탭까지는 이미 갔다.
  pushGroupRoom(seq, groupId, challengeId, resultPush).catch(() => {});
}

// 지연 이동을 계속해도 되는가 — 딥링크는 그룹 탭으로 먼저 옮겨 두고 목록 조회를 기다리는데,
// 그 사이 사용자가 **스스로** 다른 탭·화면으로 옮겼으면 조회 완료가 그 화면 위에 그룹방을
// 덮어쓴다(코덱스 리뷰). 후속 딥링크는 세대 가드가 잡지만 일반 탭 이동은 잡지 못한다.
// 판정은 **확신할 때만** 부정한다 — 현재 화면을 못 읽으면(구버전 ref·초기화 중) 기존대로 이동한다.
// 그룹 탭('그룹')과 이미 열려 있는 그룹방('GroupRoom')은 같은 흐름으로 본다.
function isStillInGroupFlow(): boolean {
  const current = navigationRef.getCurrentRoute?.()?.name;
  return current === undefined || current === '그룹' || current === 'GroupRoom';
}

async function pushGroupRoom(
  seq: number,
  groupId: string,
  challengeId: string | null,
  resultPush: boolean,
): Promise<void> {
  // 결과성 푸시(result=1)는 멤버십 게이트를 **우회**한다(PR #566 리뷰 P1 — N53·C8). 탈퇴자는
  // getMyGroups에 그 그룹이 없어 여기서 잘리는데, 그러면 참가자 스코프 결과(/me/challenge-results)
  // 를 부르는 화면(GroupRoomScreen)에 도달조차 못 한다 — 다른 소속 그룹이 없으면 결과를 볼 통로가
  // 0이 된다. 그룹방이 MEMBER_ONLY를 받으면 결과 모달을 소비시킨 뒤 스스로 물러난다(onLeft 유예).
  // 비결과성 딥링크(모집·생성·초대 등)의 게이트는 그대로다 — 탈퇴한 그룹방을 아무 경로로나 열게
  // 하지 않는다. 우회 경로는 조회 대기가 없어(동기 진행) 대기 중 화면 이탈 가드도 불필요하다.
  if (!resultPush) {
    const groups = await getMyGroups();
    if (seq !== groupLinkSeq) return; // 더 늦게 탭한 링크가 이미 이동을 맡았다
    if (!navigationRef.isReady()) {
      discardQueuedGroupEntry(seq);
      return;
    }
    if (!isStillInGroupFlow()) {
      discardQueuedGroupEntry(seq);
      return; // 사용자가 조회를 기다리는 사이 스스로 다른 화면으로 갔다
    }
    if (!groups.some((g) => g.groupId === groupId)) {
      discardQueuedGroupEntry(seq);
      return;
    }
  }
  if (!navigationRef.isReady()) {
    discardQueuedGroupEntry(seq);
    return;
  }
  // challengeId는 **없어도 키를 싣는다** — 이미 스택에 있는 GroupRoom으로 다시 navigate 하면
  // 파라미터가 병합될 수 있어, 키를 빼면 직전 딥링크의 challengeId가 남아 엉뚱한 결과 모달이
  // 다시 뜬다(새 챌린지 등록 푸시처럼 challenge 없는 링크가 뒤따르는 경우).
  // GroupRoom 우회가 확정되면 GroupScreen이 아직 소비하지 못한 push source를 폐기한다.
  // 화면 fetch가 먼저 성공했다면 이미 소비된 뒤라 no-op이고, 우회가 먼저면 다음 episode 오염을 막는다.
  clearPendingDirectGroupEntry();
  if (pendingGroupEntrySeq === seq) pendingGroupEntrySeq = null;
  navigationRef.navigate('GroupRoom', {
    groupId,
    challengeId: challengeId ?? undefined,
    entrySource: 'unknown',
    interactionId: undefined,
    interactionAcceptedAt: undefined,
  });
}

// NavigationContainer onReady에서 호출 — 준비 전에 도착한 링크를 1회 흘려보낸다.
export function flushPendingDeepLink(): void {
  if (pendingLink) {
    const link = pendingLink;
    pendingLink = null;
    navigateToDeepLink(link);
    return;
  }
  // 링크는 이미 소비됐는데 초대 버퍼만 남아 있는 경우 = **컨테이너가 새로 만들어졌다**.
  // 게스트가 초대 시트에서 소셜 로그인하면 userId가 바뀌어 <UserProvider key={userId}>가 갈리고
  // RootNavigator가 통째로 다시 마운트되는데, 새 탭 네비게이터는 홈부터 시작하고 그룹 탭은
  // 포커스 전까지 마운트되지 않는다(lazy) — GroupScreen이 peekPendingInvite()로 버퍼를 이어받을
  // 기회 자체가 없어 "로그인하면 이 초대장이 다시 열려요"라는 안내가 깨진다(§6-6).
  // 여기서 그룹 탭으로 옮겨 주면 화면이 마운트되며 같은 그룹 프리뷰가 다시 뜬다.
  if (pendingInvite && navigationRef.isReady()) {
    navigationRef.navigate('Main', { screen: '그룹' } as never);
  }
}
