// '서버 잔액이 바뀌었다'를 서비스 계층 → React 트리로 흘리는 단방향 신호(codex 리뷰 P2).
//
// **왜 신호인가**: 잔액 재조회는 useCoins().refresh 라 컨텍스트 훅이고, 푸시·딥링크 배선
// (services/push.ts · navigation/navigationRef.ts)은 React 트리 밖의 모듈이라 직접 부를 수 없다.
// navigationRef가 초대 프리뷰를 모듈 버퍼 + 리스너로 화면에 넘기는 것과 같은 방식으로,
// 여기서는 '잔액을 다시 받아라'는 사실만 넘기고 실제 호출은 CoinProvider가 한다.
//
// 리스너가 아직 없으면 요청을 1건 버퍼링한다 — 콜드스타트에서 딥링크가 CoinProvider 마운트보다
// 먼저 처리될 여지를 남기지 않는다(등록되는 순간 흘려보낸다). 여러 번 쌓아도 할 일은 '한 번 더
// 조회'라 불리언 하나면 충분하다.
let listener: (() => void) | null = null;
let pending = false;

// CoinProvider가 마운트/언마운트에서 등록·해제한다. 등록 시 보류분이 있으면 즉시 흘려보낸다.
export function setCoinRefreshListener(fn: (() => void) | null): void {
  listener = fn;
  if (!fn || !pending) return;
  pending = false;
  fn();
}

// 서버가 잔액을 바꿨다고 아는 쪽(환불 푸시 딥링크 등)이 부른다.
// 과하게 불러도 안전하다 — 서버 재조회일 뿐이고 refresh는 throw 없이 false를 돌려준다.
export function requestCoinRefresh(): void {
  if (listener) listener();
  else pending = true;
}
