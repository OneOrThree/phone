package com.oneorthree.business.auth;

/** 필터가 요청에 심고 리졸버·컨트롤러가 꺼내는 속성 키. 문자열을 직접 쓰면 오타가 조용한 null 이 된다. */
public final class AuthAttributes {

    /** {@link AccessTokenClaims} — 검증을 통과한 AT 의 클레임 묶음. */
    public static final String CLAIMS = "business.auth.claims";

    /**
     * 검증한 AT subject 의 문자열 표현.
     *
     * <p><b>이름이 계약이다.</b> 미리보기 계열 핸들러({@code linkpreview})가 {@code "userId"} 리터럴로
     * 이 속성을 읽는다(1747). 키를 바꾸면 그쪽은 예외 없이 <b>null 사용자</b>로 동작해 캐시가 모든
     * 사용자에게 한 네임스페이스를 공유하게 된다 — 컴파일도 테스트도 그걸 잡지 못한다.
     *
     * <p>{@link #CLAIMS} 와 중복이지만 지운 것이 아니다: 새 코드는 {@code CLAIMS}(또는
     * {@code @LoginUser})를 쓰고, 이 키는 기존 미리보기 경로의 호환 표면으로만 남긴다.
     */
    public static final String USER_ID = "userId";

    private AuthAttributes() {
    }
}
