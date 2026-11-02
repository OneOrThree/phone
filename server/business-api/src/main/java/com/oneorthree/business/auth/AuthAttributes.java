package com.oneorthree.business.auth;

/** 필터가 요청에 심고 리졸버·컨트롤러가 꺼내는 속성 키. 문자열을 직접 쓰면 오타가 조용한 null 이 된다. */
public final class AuthAttributes {

    /** {@link AccessTokenClaims} — 검증을 통과한 AT 의 클레임 묶음. */
    public static final String CLAIMS = "business.auth.claims";

    private AuthAttributes() {
    }
}
