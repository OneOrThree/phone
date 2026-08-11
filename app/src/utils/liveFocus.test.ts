// 내 그리드 셀 표시값 결합 규칙(GROMO-1246) — 서버 KST 버킷 + 진행 델타, 단조 바닥.
import { myLiveTotalSeconds } from './liveFocus';

// 대부분의 케이스는 KR 기기(동축) 기준 — 축이 갈린 케이스만 sameAxis:false 를 명시한다.
const base = {
  serverBase: null as number | null,
  delta: 0,
  localFallback: 0,
  shownFloor: 0,
  sameAxis: true,
};

describe('myLiveTotalSeconds', () => {
  it('서버 스냅샷이 없으면 로컬 집계로 폴백(그룹 미가입·조회 실패)', () => {
    expect(myLiveTotalSeconds({ ...base, serverBase: null, delta: 120, localFallback: 900 })).toBe(
      900,
    );
  });

  it('스냅샷 기준일이 지나 무효화되면(자정 통과 + 폴링 실패) 로컬 집계로 폴백', () => {
    // 호출부가 day !== todayStrKst() 를 보고 serverBase를 null로 내린 상태 (코덱스 리뷰 ②).
    expect(myLiveTotalSeconds({ ...base, serverBase: null, delta: 30, localFallback: 45 })).toBe(
      45,
    );
  });

  it('폴백 구간에서는 서버 축 바닥을 적용하지 않는다', () => {
    // 축이 갈린 기기 — 서버 축 바닥(2400)이 남아 있어도 폴백 값(45)을 그대로 돌려준다.
    expect(
      myLiveTotalSeconds({
        ...base,
        serverBase: null,
        delta: 30,
        localFallback: 45,
        shownFloor: 2400,
        sameAxis: false,
      }),
    ).toBe(45);
  });

  it('서버 기준값에 진행 중 세션 델타를 얹는다', () => {
    expect(myLiveTotalSeconds({ ...base, serverBase: 1800, delta: 90, localFallback: 1200 })).toBe(
      1890,
    );
  });

  it('동축이면 서버 분 내림으로 타일이 뒤로 가지 않는다', () => {
    // 서버는 GroupService 에서 `/ 60` 내림이라 2분 59초가 2분(120초)으로 온다. 첫 응답 전에는
    // 초까지 정확한 폴백(179)을 보여주고 있었으므로 그대로 179를 유지해야 한다 (코덱스 리뷰 ⑦).
    expect(myLiveTotalSeconds({ ...base, serverBase: 120, delta: 0, localFallback: 179 })).toBe(
      179,
    );
  });

  it('정산 직후 폴링 전에도 방금 정산한 블록이 사라지지 않는다', () => {
    // 정산으로 delta가 0이 되고 서버는 아직 옛 스냅샷(1800) → raw는 1800으로 뒤로 밀린다.
    // 직전에 2400을 보여줬으므로 바닥이 그대로 유지되어야 한다 (코덱스 리뷰 ③).
    expect(myLiveTotalSeconds({ ...base, serverBase: 1800, shownFloor: 2400 })).toBe(2400);
  });

  it('서버가 정산분을 반영해도 이중 계상되지 않는다', () => {
    // 폴링이 정산분(600)을 반영해 serverBase가 2400으로 올라온 상태 — 여전히 2400.
    // 후보가 raw 아니면 과거의 raw뿐이라 같은 블록이 두 번 더해질 수 없다 (코덱스 리뷰 ④).
    expect(myLiveTotalSeconds({ ...base, serverBase: 2400, shownFloor: 2400 })).toBe(2400);
  });

  it('첫 스냅샷이 정산 뒤에 늦게 도착해도 부풀지 않는다', () => {
    // 첫 폴링 실패 → 5분 블록 정산·업로드 → 첫 성공 스냅샷이 이미 그 블록을 포함(300).
    // 바닥·로컬 모두 300이라 결과도 300 — 600으로 부풀지 않는다 (코덱스 리뷰 ④).
    expect(
      myLiveTotalSeconds({ ...base, serverBase: 300, localFallback: 300, shownFloor: 300 }),
    ).toBe(300);
  });

  it('축이 갈리면 로컬 집계를 하한으로 쓰지 않는다', () => {
    // 비KST 기기가 KST 자정을 넘긴 직후 — 로컬 당일 누적(5시간)은 다른 KST 날짜 몫이다.
    // 새 KST 날의 올바른 값(10분)이 그대로 나와야 한다 (코덱스 리뷰 ⑥).
    expect(
      myLiveTotalSeconds({
        ...base,
        serverBase: 600,
        localFallback: 18000,
        sameAxis: false,
      }),
    ).toBe(600);
  });

  it('다른 기기가 올린 몫으로 서버가 앞서가면 서버 값을 따른다', () => {
    expect(myLiveTotalSeconds({ ...base, serverBase: 3000, delta: 15, shownFloor: 2400 })).toBe(
      3015,
    );
  });
});
