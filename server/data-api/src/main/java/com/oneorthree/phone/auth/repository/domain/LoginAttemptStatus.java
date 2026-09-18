package com.oneorthree.phone.auth.repository.domain;

/**
 * 로그인 시도의 수명 (계정 LLD §3 「로그인 CAS 충돌의 재준비 전이」).
 *
 * <p>이름이 그대로 DB {@code login_attempts.status} 의 CHECK 값이다 — 개명하면 기존 행이 제약을
 * 위반한다.
 */
public enum LoginAttemptStatus {

    /** 실행권을 선점했고 결과가 아직 없다. 외부에서 쓸 수 있는 세션이 아니다. */
    PENDING,

    /** 결과 확정. 같은 자격의 재요청은 여기서 재생된다. */
    COMPLETED,

    /**
     * 폐기가 아닌 CAS 경쟁 패배 — 같은 시도·같은 자격으로 새 nonce 를 한 번 다시 준비한다.
     *
     * <p><b>지금은 기록되지 않는다.</b> 이 경쟁은 Business 가 서명 주체가 되어 「준비 → 서명 →
     * 확정 CAS」가 세 단계로 갈릴 때 생긴다(LLD §3). GROMO-1908 은 티켓 지시대로 Data 의 기존
     * {@code AuthService.socialLogin} 을 자격 검증 조각으로 재사용하므로 발급이 한 트랜잭션 안에서
     * 끝나 경쟁할 자리가 없다. 서명 이관(GROMO-1661)이 이 상태를 켠다 — 계약상의 상태라 이름만
     * 미리 고정해 둔다.
     */
    REPREPARE_REQUIRED,

    /** 탈퇴·세션 폐기·복구 창 종료. 영구 종료이며 재준비·토큰 재생이 모두 금지된다. */
    INVALIDATED
}
