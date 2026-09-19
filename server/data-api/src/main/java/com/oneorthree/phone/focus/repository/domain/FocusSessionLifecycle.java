package com.oneorthree.phone.focus.repository.domain;

/**
 * v0.3 집중 세션 상세({@link FocusSessionDetail})의 생명주기 (GROMO-1764).
 *
 * <p>레거시 {@link FocusSessionStatus}와는 별개 축이다 — HLD가 "enum 일괄 개명 금지, 새 lifecycle은
 * 별도 상세 행에서 해석"이라고 정했으므로 기존 enum에 값을 더하지 않고 이 표의 컬럼으로 둔다.
 * 기본 {@code FocusSession} 행은 진행 중(active/paused) 동안 {@code status=ACTIVE, endedAt=null}을
 * 유지하고, 이 값이 실제 "지금 집중 중인가/쉬는 중인가"를 가른다.
 */
public enum FocusSessionLifecycle {
    /** 집중 중 — 열린 ACTIVE 구간이 있다. */
    ACTIVE,
    /** 일시정지(모닥불 휴식) — 열린 REST 구간이 있다. */
    PAUSED,
    /** 정상 완료 — finish 정산까지 끝났다({@code focus_settlements} 에 그 세션의 행이 꼭 있다). */
    COMPLETED,
    /**
     * 기본 마커가 바깥에서 닫혀 더 진행할 수 없게 된 세션 — <b>정상 완료가 아닌 종결</b>이다.
     *
     * <p>이렇게 만드는 주체는 레거시 {@code FocusService.startFocusSession}이다. 그쪽은
     * {@code FocusSessionRepository.autoCloseOpenMarkersOf}로 <b>그 사용자의 열린
     * {@code focus_sessions} 행을 조건 없이 전부</b> {@code AUTO_CLOSED}로 닫는데, v0.3 세션의
     * 기본 행도 구분 없이 같이 닫힌다(1.x 앱이 아직 그 경로를 쓴다). 그러면
     * 「lifecycle이 ACTIVE/PAUSED면 그 세션의 {@code focus_sessions.ended_at IS NULL}」이라는
     * 불변식이 깨지고, 상세만 진행 중으로 남아 V58의 부분 UNIQUE
     * ({@code focus_session_details_user_progressing_uk})가 그 사용자의 다음 start를 영영 막는다.
     *
     * <p>{@link com.oneorthree.phone.internal.service.FocusSessionLifecycleService}가 진행 중 상세를
     * 집을 때마다 그 불변식을 되보고, 깨져 있으면 이 값으로 내린 뒤 정직하게 답한다. 레거시 쪽은
     * 고치지 않는다 — 거기 손대면 「사용자당 열린 마커 1개」 관례나 1.x 앱 동작이 바뀐다.
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
