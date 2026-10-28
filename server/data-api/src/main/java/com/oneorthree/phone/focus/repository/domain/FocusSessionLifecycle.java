package com.oneorthree.phone.focus.repository.domain;

/**
 * 집중 세션 상세의 상태. 기본 행의 {@link FocusSessionStatus}와 별도로 집중·휴식을 구분한다.
 *
 * <p>ACTIVE·PAUSED 동안 기본 세션은 {@code status=ACTIVE, endedAt=null}을 유지한다.
 */
public enum FocusSessionLifecycle {
    /** 집중 중 — 열린 ACTIVE 구간이 있다. */
    ACTIVE,
    /** 일시정지(모닥불 휴식) — 열린 REST 구간이 있다. */
    PAUSED,
    /** 정상 완료 — finish 정산까지 끝났다({@code focus_settlements} 에 그 세션의 행이 꼭 있다). */
    COMPLETED,
    /**
     * 기본 세션은 종료됐지만 상세가 진행 중으로 남은 기록의 정리 상태.
     *
     * <p>수명주기 서비스가 불일치를 발견하면 이 상태로 종결해 다음 시작을 막지 않도록 한다.
     * 정상 완료 정산은 수행하지 않는다.
     */
    ABANDONED,
    /**
     * 섬 소속을 잃어(강퇴) 서버가 종결한 세션 — 2026-09-18 결정 FR-D03(B1 「강제 종료, 미정산」, GROMO-1924).
     *
     * <p>{@link #ABANDONED} 와 <b>섞지 않는다</b> — 둘 다 정상 완료가 아니고 정산이 없지만, 한쪽은 기본
     * 마커가 밖에서 닫힌 사고의 정리이고 이쪽은 강퇴라는 정책의 결과다. 한 값으로 접으면 원인을 추적할
     * 수 없다(FR-D03 「종결 사유는 ABANDONED 와 구분되는 값으로 남긴다」). 이 값이 V58 의
     * {@code varchar(10)} 를 넘어 V67 이 열 폭과 CHECK 를 넓혔다.
     */
    MEMBERSHIP_LOST
}
