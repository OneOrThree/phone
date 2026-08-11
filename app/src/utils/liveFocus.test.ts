// 내 그리드 셀 표시값 결합 규칙(GROMO-1246) — 서버 버킷 기준화 + 진행 중 델타.
import { myLiveTotalSeconds } from './liveFocus';

describe('myLiveTotalSeconds', () => {
  it('서버 스냅샷이 없으면 로컬 집계 그대로(그룹 미가입·조회 실패)', () => {
    expect(
      myLiveTotalSeconds({ serverBase: null, serverDelta: 120, localTotal: 900, sameAxis: true }),
    ).toBe(900);
  });

  it('서버 기준값에 진행 중 세션 델타를 얹는다', () => {
    // 서버 30분 + 미정산 90초, 로컬 집계는 아직 따라오지 못한 상태
    expect(
      myLiveTotalSeconds({ serverBase: 1800, serverDelta: 90, localTotal: 1200, sameAxis: true }),
    ).toBe(1890);
  });

  it('정산 직후 폴링 공백은 로컬 집계가 바닥을 깐다(동축)', () => {
    // 블록 정산으로 델타는 0이 됐지만 서버 폴링 전 — 서버 값만 쓰면 1500초로 뒤로 밀린다
    expect(
      myLiveTotalSeconds({ serverBase: 1500, serverDelta: 0, localTotal: 3000, sameAxis: true }),
    ).toBe(3000);
  });

  it('축이 갈리면 로컬 집계를 섞지 않는다(다른 날짜 몫)', () => {
    expect(
      myLiveTotalSeconds({ serverBase: 1500, serverDelta: 60, localTotal: 3000, sameAxis: false }),
    ).toBe(1560);
  });
});
