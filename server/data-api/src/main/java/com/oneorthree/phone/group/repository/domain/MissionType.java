package com.oneorthree.phone.group.repository.domain;

/**
 * 챌린지 미션 형태 — 목표를 <b>언제</b> 재느냐의 축. 형태별 상세는 CTI 테이블로 갈린다
 * ({@link #TIME_WINDOW} → group_challenge_windows, {@link #DURATION} → group_challenge_durations).
 *
 * <p>회차({@link GroupChallengeBetSession})는 이 값을 개설 시점에 스냅샷으로 박제한다 — 판정 기준이
 * 회차 도중에 바뀌지 않게 하기 위해서다.
 */
public enum MissionType {
    /**
     * 창형 — 지정한 시간대(window_start~window_end, KST 벽시계) 안의 진행분만 인정한다.
     * 자정 걸침은 금지(§A6-1)라 창은 항상 회차일 안에서 닫히고, 정산은 창이 닫힌 뒤 30분 그레이스가 지나야 돈다.
     */
    TIME_WINDOW,
    /** 하루형 — 회차일 하루치 누적 목표(분)만 본다. 시간대 제약이 없어 참가 마감이 자정이다. */
    DURATION
}
