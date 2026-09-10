package com.oneorthree.chat.auth;

/**
 * 인증이 끝난 뒤 요청에 심어 두는 속성 키.
 *
 * <p>문자열 리터럴을 필터와 리졸버 양쪽에 적어 두면 한쪽 오타가 «인증은 통과했는데 userId 는 null»
 * 이라는 조용한 실패가 된다. 키를 한 군데로 모아 그 오타를 컴파일 시점으로 끌어올린다.
 */
public final class AuthAttributes {

    /** 값 타입은 {@link java.util.UUID} 다 — 문자열로 심으면 리졸버의 캐스팅이 런타임에 터진다. */
    public static final String USER_ID = "authUserId";

    private AuthAttributes() {
    }
}
