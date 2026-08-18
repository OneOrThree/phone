// "지금 그룹 흐름 안인가" 판정 — 챌린지 결과 모달 호스트(ChallengeResultHost)가 쓴다.
//
// 호스트는 루트(NavigationContainer 바깥)에 있어 화면별 `useIsFocused`를 쓸 수 없다. 대신
// navigationRef가 알려주는 **현재 라우트 이름**만 보고 판정한다. 그래서 판정은 네비게이션
// 구현과 무관한 순수 함수로 떼어 내고 단위 테스트로 고정한다 — 라우트가 추가·개명될 때
// 이 목록이 조용히 낡는 것이 이 배선의 유일한 실패 모드다.
//
// ⚠️ **모르면 '그룹 흐름 아님'으로 강하한다.** 컨테이너가 아직 준비되지 않았거나 라우트를 읽지
//    못하면(undefined) false다 — 홈·리그·집중 세션 위에 정산 결과 모달이 튀어나오는 쪽이,
//    한 박자 늦게 뜨는 쪽보다 훨씬 나쁘다(결과는 다음 판정에서 다시 뜬다).

// 탭 네비게이터의 그룹 탭 — 라우트 이름이 한글 그대로다(RootNavigator의 Tab.Screen name).
export const GROUP_TAB_ROUTE = '그룹';

// 그룹 흐름으로 보는 라우트 전부 — 탭 1개 + 루트 스택의 Group* 화면들(navigation/types.ts).
// 그룹방(GroupRoom)이 여기 있는 것이 이 배치의 존재 이유다: 예전 소유자(GroupRoomScreen)는
// 루트 스택 sibling 위로 뜰 수 없어, 방이 push된 상태에서 결과가 도착하면 갈 곳이 없었다.
const GROUP_FLOW_ROUTES: readonly string[] = [
  GROUP_TAB_ROUTE,
  'GroupCreate',
  'GroupRoom',
  'GroupNotice',
  'GroupChallengeHistory',
  'GroupSettings',
  'GroupCardEmojiEdit',
  'GroupProfileEdit',
  'GroupMemberManage',
  'GroupOwnerTransfer',
  'GroupNoticePermission',
];

export function isGroupFlowRoute(routeName: string | null | undefined): boolean {
  if (typeof routeName !== 'string' || routeName.length === 0) return false;
  return GROUP_FLOW_ROUTES.includes(routeName);
}
