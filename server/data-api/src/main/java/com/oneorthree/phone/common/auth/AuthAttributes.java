package com.oneorthree.phone.common.auth;

/** InternalAuthFilter와 TraceIdFilter가 공유하는 인증 요청 속성. */
public final class AuthAttributes {

    /** InternalAuthFilter가 인증 성공 시 심는 사용자 PK (UUID). */
    public static final String USER_ID = "userId";

    private AuthAttributes() {
    }
}
