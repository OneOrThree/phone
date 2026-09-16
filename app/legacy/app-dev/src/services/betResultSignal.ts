// '정산 결과 푸시가 방금 도착했다'를 서비스 계층 → 화면으로 흘리는 단방향 신호(GROMO-1580).
//
// **왜 필요한가**: 종료 푸시(CHALLENGE_WINDOW_END·CHALLENGE_ENDED)는 정산 **전**에 온다. 그래서
// 그 푸시를 탭해 들어와도 방금 끝난 회차는 아직 /me/challenge-results에 없고, GroupRoomScreen은
// 지목을 focusPendingRef에 유예 보관한 채 "다음 재조회"를 기다린다(PR #566 리뷰 ③이 검토·승인한
// 트레이드오프 — 이 설계 자체는 유지한다). 문제는 그 '다음 재조회'의 계기가 useFocusEffect ·
// AppState active 복귀 · focusChallengeId 변경 셋뿐이라는 것이다: 푸시를 탭해 들어와 **그 방에
// 머무르는 포그라운드 구간**에서는 셋 중 무엇도 발화하지 않아, 정산이 끝나 BET_RESULT가 도착해도
// 사용자는 아무것도 못 보고 대기한다.
//
// **왜 폴링이 아닌가**: 폴링은 상한·중단 조건·백오프를 새로 규정해야 하고(언제까지 몇 초마다,
// 화면을 떠나면·실패하면 어떻게), 정산 시각을 모르는 앱이 그 값을 정할 근거가 없다. 서버가
// 정산 직후 보내는 BET_RESULT가 바로 그 사건의 정본 신호라 그것만 받아 한 번 재조회한다.
//
// **왜 보류(pending)를 두지 않는가**: coinRefreshSignal과 달리 이 신호는 놓쳐도 유실이 아니다 —
// 화면이 없거나 안 보이는 상태였다면 다음 포커스(useFocusEffect)가 어차피 같은 재조회를 한다.
// 보류를 남기면 오히려 한참 뒤 엉뚱한 시점의 중복 조회가 된다.
type BetResultListener = () => void;

// 방이 여러 개 떠 있을 수 있다(스택에 남은 이전 그룹방) — Set으로 두고 각자 자기 포커스 여부를
// 보고 판단하게 한다. 구독 해제는 반환된 함수로만 한다(다른 화면 구독을 지우지 않게).
const listeners = new Set<BetResultListener>();

export function subscribeBetResultPush(fn: BetResultListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// 포그라운드에서 정산 결과 푸시를 받은 쪽(services/push.ts)이 부른다.
// 리스너가 없으면 아무 일도 일어나지 않는다(위 '보류 없음' 주석).
export function notifyBetResultPush(): void {
  // 순회 중 구독 해제가 끼어들어도 안전하게 복사본을 돈다.
  [...listeners].forEach((fn) => fn());
}
