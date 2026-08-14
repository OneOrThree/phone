// '이 그룹방 진입은 환불 푸시가 만든 것이다'를 푸시 계층 → 네비게이션으로 넘기는 1회용 표식
// (GROMO-1579 · codex 사전 게이트 P2).
//
// **왜 딥링크 파라미터로는 안 되는가**: `refund=1`은 `gromo://` URL에 실려 있고, DeepLinkGate는
// OS가 준 URL을 그대로 navigateToDeepLink에 넘긴다. 즉 외부 앱이나 웹페이지가 유효한 그룹 UUID와
// 함께 `gromo://group?g=<uuid>&result=1&refund=1`을 열 수 있다. 그 표식만 믿고 환불 안내를 세우면
// **실제로는 아무 환불도 없었는데 "참가비가 환불됐어요"라는 금융 사실이 화면에 뜬다.**
// 멤버십 게이트 우회(result=1)는 화면 도달까지만 바꾸지만, 환불 안내는 사용자가 사실로 읽는
// 문장을 쓴다 — 위조 비용이 같아도 결과의 무게가 다르다.
//
// 그래서 표식은 라우팅 힌트로만 쓰고, **푸시가 그 링크를 만들었다는 사실**은 앱 안에서만 도는 이
// 모듈로 따로 넘긴다. 외부에서 URL을 아무리 잘 만들어도 이 표식은 서지 않는다.
//
// **왜 groupId까지 대조하는가**: 표식을 세운 뒤 사용자가 다른 그룹방을 열 수도 있다. 대상이
// 어긋나면 소비하지 않고 버려야 엉뚱한 방에 환불 안내가 서지 않는다.
//
// **왜 1회용인가**: 한 번의 착지를 위한 것이다. 남겨 두면 다음 진입이 물려받아, 푸시와 무관한
// 재진입에서 안내가 다시 뜬다.
let pendingGroupId: string | null = null;

// 푸시를 탭해 딥링크로 보내기 직전에 부른다(services/push.ts).
export function markRefundPushIntent(groupId: string): void {
  pendingGroupId = groupId;
}

// 그룹방 라우팅이 부른다. 대상이 맞든 틀리든 **표식은 비운다** — 맞으면 소비한 것이고,
// 틀리면 그 표식은 이미 유효한 착지 기회를 지나쳤으므로 남길 이유가 없다.
export function consumeRefundPushIntent(groupId: string): boolean {
  const matched = pendingGroupId === groupId;
  pendingGroupId = null;
  return matched;
}

// 테스트 전용 — 모듈 스코프 상태가 케이스 사이에 새지 않게 한다.
export function resetRefundPushIntent(): void {
  pendingGroupId = null;
}
