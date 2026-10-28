package com.oneorthree.phone.config;

/**
 * 내부 표면 인증이 request 에 심는 속성 키 (A22 ㊀).
 *
 * <p>{@code AuthAttributes} 와 나눈 이유는 축이 다르기 때문이다 — 그쪽은 「앱 사용자」이고 이쪽은
 * 「호출한 서비스」다. 한 상수 묶음에 두면 앱 경로가 caller 를 읽거나 그 반대가 되는 실수가 컴파일을
 * 통과한다.
 */
public final class InternalCallAttributes {

    /** {@code InternalAuthFilter} 가 심는 호출자 이름(설정의 caller 키). 로그·감사에만 쓴다. */
    public static final String CALLER = "internalCaller";

    private InternalCallAttributes() {
    }
}
