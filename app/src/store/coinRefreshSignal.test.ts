// 잔액 재조회 신호(codex 리뷰 P2) — 서비스 계층(푸시 딥링크) → React 트리 단방향 전달.
//
// 여기서 잠그는 것: 리스너가 아직 없을 때 온 요청이 **증발하지 않는다**. 콜드스타트에서
// 환불 푸시를 탭하면 딥링크 처리가 CoinProvider 마운트보다 앞설 여지가 있고, 그때 요청이
// 사라지면 '앱을 켰더니 환불 전 잔액'이 그대로 재현된다.
import { requestCoinRefresh, setCoinRefreshListener } from './coinRefreshSignal';

// 조회 성공/실패를 그대로 흉내 내는 리스너 — 반환값이 곧 '반영됐는가'(CoinContext.refresh 계약).
function listenerOf(applied: boolean) {
  return jest.fn(async () => applied);
}

// drain은 then 체인이라 한 틱 뒤에 pending이 정리된다.
const tick = () => Promise.resolve();

afterEach(async () => {
  // 다음 테스트로 보류가 새지 않게 성공 리스너로 비우고 해제한다.
  setCoinRefreshListener(listenerOf(true));
  await tick();
  setCoinRefreshListener(null);
});

test('리스너가 붙어 있으면 즉시 전달한다', () => {
  const listener = listenerOf(true);
  setCoinRefreshListener(listener);

  requestCoinRefresh();

  expect(listener).toHaveBeenCalledTimes(1);
});

test('리스너가 없으면 버퍼링했다가 등록 시점에 흘려보낸다', () => {
  setCoinRefreshListener(null);
  requestCoinRefresh(); // 아직 Provider가 없다

  const listener = listenerOf(true);
  setCoinRefreshListener(listener);

  expect(listener).toHaveBeenCalledTimes(1);
});

test('성공하면 보류가 내려간다 — 다음 등록에서 다시 조회하지 않는다', async () => {
  setCoinRefreshListener(null);
  requestCoinRefresh();
  setCoinRefreshListener(listenerOf(true));
  await tick();

  const next = listenerOf(true);
  setCoinRefreshListener(next);

  expect(next).not.toHaveBeenCalled();
});

// 여기가 이 파일의 본체(codex 후속 리뷰 P2) — 삭제 환불은 결과 모달도 정산 서명 변화도 없어
// **재조회 계기가 다시 오지 않는다.** 한 번의 실패로 요청이 증발하면 그대로 영구 오표시다.
test('조회가 실패하면 보류를 유지한다 — 다음 등록에서 다시 시도한다', async () => {
  const failing = listenerOf(false); // 실패·시퀀스 가드에 밀린 미반영 둘 다 false다
  setCoinRefreshListener(failing);

  requestCoinRefresh();
  await tick();
  expect(failing).toHaveBeenCalledTimes(1);

  // Provider가 다시 마운트되면(또는 다른 리스너가 붙으면) 보류가 살아 있어 재시도된다.
  const retry = listenerOf(true);
  setCoinRefreshListener(retry);
  expect(retry).toHaveBeenCalledTimes(1);
  await tick();

  // 이번엔 성공했으니 더는 남지 않는다.
  const next = listenerOf(true);
  setCoinRefreshListener(next);
  expect(next).not.toHaveBeenCalled();
});

test('리스너가 던져도 보류가 살아남는다(throw 안전)', async () => {
  const throwing = jest.fn(async () => {
    throw new Error('boom');
  });
  setCoinRefreshListener(throwing as unknown as () => Promise<boolean>);
  requestCoinRefresh();
  await tick();

  const retry = listenerOf(true);
  setCoinRefreshListener(retry);
  expect(retry).toHaveBeenCalledTimes(1);
});

test('요청이 없으면 등록만으로 조회를 만들지 않는다', () => {
  const listener = listenerOf(true);
  setCoinRefreshListener(listener);

  expect(listener).not.toHaveBeenCalled();
});
