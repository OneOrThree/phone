// 잔액 재조회 신호(codex 리뷰 P2) — 서비스 계층(푸시 딥링크) → React 트리 단방향 전달.
//
// 여기서 잠그는 것: 리스너가 아직 없을 때 온 요청이 **증발하지 않는다**. 콜드스타트에서
// 환불 푸시를 탭하면 딥링크 처리가 CoinProvider 마운트보다 앞설 여지가 있고, 그때 요청이
// 사라지면 '앱을 켰더니 환불 전 잔액'이 그대로 재현된다.
import { requestCoinRefresh, setCoinRefreshListener } from './coinRefreshSignal';

afterEach(() => {
  setCoinRefreshListener(null);
});

test('리스너가 붙어 있으면 즉시 전달한다', () => {
  const listener = jest.fn();
  setCoinRefreshListener(listener);

  requestCoinRefresh();

  expect(listener).toHaveBeenCalledTimes(1);
});

test('리스너가 없으면 버퍼링했다가 등록 시점에 흘려보낸다', () => {
  setCoinRefreshListener(null);
  requestCoinRefresh(); // 아직 Provider가 없다

  const listener = jest.fn();
  setCoinRefreshListener(listener);

  expect(listener).toHaveBeenCalledTimes(1);
});

test('버퍼는 1회만 소비된다 — 다음 등록에서 다시 조회하지 않는다', () => {
  setCoinRefreshListener(null);
  requestCoinRefresh();
  setCoinRefreshListener(jest.fn());

  const next = jest.fn();
  setCoinRefreshListener(next);

  expect(next).not.toHaveBeenCalled();
});

test('요청이 없으면 등록만으로 조회를 만들지 않는다', () => {
  const listener = jest.fn();
  setCoinRefreshListener(listener);

  expect(listener).not.toHaveBeenCalled();
});
