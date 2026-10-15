package com.oneorthree.phone.auth.repository.domain;

/**
 * 계정 전환 시도의 단계 (GROMO-1992 · V101 {@code ck_login_attempts_switch_state}).
 *
 * <p>이름이 그대로 DB {@code login_attempts.switch_phase} 의 CHECK 값이다 — 개명하면 기존 행이
 * 제약을 위반한다. 「전환이 아닌 시도」는 {@code NONE} 상수가 아니라 컬럼 <b>null</b> 로 표현한다 —
 * CHECK 의 세 모양 중 첫째 절이 그 모양이다.
 */
public enum LoginAttemptSwitchPhase {

    /**
     * 전환 검증이 끝났다 — source 게스트·세션·세대와 target 회원·social account 가 확정됐다.
     * 이 상태에서 {@code complete} 는 불법이다 — 게스트 원천 정리({@link #GUEST_WITHDRAWN})를
     * 거치지 않은 완료는 전환 결과를 재생할 근거를 남기지 않는다.
     */
    VERIFIED,

    /** source 게스트가 탈퇴·정리돼 전환의 원천이 사라졌다. 여기서만 {@code complete} 로 간다. */
    GUEST_WITHDRAWN
}
