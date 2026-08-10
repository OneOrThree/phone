// '서버 잔액이 바뀌었다'를 서비스 계층 → React 트리로 흘리는 단방향 신호(codex 리뷰 P2).
//
// **왜 신호인가**: 잔액 재조회는 useCoins().refresh 라 컨텍스트 훅이고, 푸시·딥링크 배선
// (services/push.ts · navigation/navigationRef.ts · services/pushBackground.ts)은 React 트리
// 밖의 모듈이라 직접 부를 수 없다. navigationRef가 초대 프리뷰를 모듈 버퍼 + 리스너로 화면에
// 넘기는 것과 같은 방식으로, 여기서는 '잔액을 다시 받아라'는 사실만 넘기고 실제 호출은
// CoinProvider가 한다.
//
// **보류는 조회가 성공할 때까지 유지한다**(codex 후속 리뷰 P2). 예전엔 리스너를 등록하는 순간
// 보류 표시를 먼저 지우고 호출했는데, 그 조회가 실패하거나 겹친 조회에 밀려 폐기되면
// (CoinContext의 refreshSeqRef — 최신 호출만 반영) 요청 사실이 통째로 사라졌다. 삭제 환불은
// 결과 모달도 정산 서명 변화도 없어 **재조회 계기가 다시 오지 않으므로**, 그 한 번의 유실이
// 곧 영구 오표시(환불 전 잔액)다. 그래서 refresh가 '반영됐다(true)'를 돌려줄 때만 내린다.
type CoinRefreshListener = () => Promise<boolean>;

let listener: CoinRefreshListener | null = null;
let pending = false;

// 보류를 흘려보낸다 — **성공(반영됨)일 때만** 내린다. 실패·미반영이면 남겨 두고 다음 기회
// (Provider 재마운트·다음 요청)에 다시 시도한다. 과하게 조회해도 안전하다(멱등한 서버 재조회).
function drain(fn: CoinRefreshListener): void {
  fn().then(
    (applied) => {
      if (applied) pending = false;
    },
    () => {
      // 실패는 보류 유지로 말한다 — 여기서 삼켜도 사실은 pending에 남는다.
    },
  );
}

// CoinProvider가 마운트/언마운트에서 등록·해제한다. 등록 시 보류분이 있으면 즉시 흘려보낸다.
export function setCoinRefreshListener(fn: CoinRefreshListener | null): void {
  listener = fn;
  if (!fn || !pending) return;
  drain(fn);
}

// 서버가 잔액을 바꿨다고 아는 쪽(환불 푸시 딥링크·백그라운드 집중 커밋)이 부른다.
// 리스너가 없으면(콜드스타트에서 딥링크가 Provider 마운트보다 앞서는 경우) 보류로 남아
// 등록 시점에 흘러간다. 과하게 불러도 안전하다 — 서버 재조회일 뿐이고 refresh는 throw하지 않는다.
export function requestCoinRefresh(): void {
  pending = true;
  if (listener) drain(listener);
}
