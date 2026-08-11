// 내 그리드 셀 표시값 결합 규칙(GROMO-1246) — 서버 KST 버킷 기준화 + 진행 중 델타.
import { myLiveTotalSeconds } from './liveFocus';

describe('myLiveTotalSeconds', () => {
  it('서버 스냅샷이 없으면 로컬 집계 그대로(그룹 미가입·조회 실패)', () => {
    expect(
      myLiveTotalSeconds({
        serverBase: null,
        sessionBase: null,
        settledServer: 0,
        delta: 120,
        localFallback: 900,
      }),
    ).toBe(900);
  });

  it('스냅샷 기준일이 지나 무효화되면(자정 통과 + 폴링 실패) 로컬 집계로 폴백', () => {
    // 소비처가 day !== todayStrKst() 를 보고 serverBase를 null로 내린 상태 (코덱스 리뷰 ②)
    expect(
      myLiveTotalSeconds({
        serverBase: null,
        sessionBase: 1800,
        settledServer: 600,
        delta: 30,
        localFallback: 45,
      }),
    ).toBe(45);
  });

  it('서버 기준값에 진행 중 세션 델타를 얹는다', () => {
    // 서버 30분, 정산분 없음, 미정산 90초
    expect(
      myLiveTotalSeconds({
        serverBase: 1800,
        sessionBase: 1800,
        settledServer: 0,
        delta: 90,
        localFallback: 1200,
      }),
    ).toBe(1890);
  });

  it('정산 직후 폴링 전에도 방금 정산한 블록이 사라지지 않는다', () => {
    // 정산으로 delta는 0, 서버는 아직 옛 스냅샷(1800) — sessionBase + settled 가 이겨야 한다
    expect(
      myLiveTotalSeconds({
        serverBase: 1800,
        sessionBase: 1800,
        settledServer: 600,
        delta: 0,
        localFallback: 0,
      }),
    ).toBe(2400);
  });

  it('서버가 정산분을 반영하면 이중 계상되지 않는다', () => {
    // 폴링이 정산분(600)을 반영해 serverBase가 2400으로 올라온 상태 — 여전히 2400
    expect(
      myLiveTotalSeconds({
        serverBase: 2400,
        sessionBase: 1800,
        settledServer: 600,
        delta: 0,
        localFallback: 0,
      }),
    ).toBe(2400);
  });

  it('다른 기기가 올린 몫으로 서버가 앞서가면 서버 값을 따른다', () => {
    expect(
      myLiveTotalSeconds({
        serverBase: 3000,
        sessionBase: 1800,
        settledServer: 600,
        delta: 15,
        localFallback: 0,
      }),
    ).toBe(3015);
  });
});
