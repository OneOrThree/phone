package com.oneorthree.phone.common.auth;

/**
 * 인증 단계에서 request 에 심는 속성 키 모음 (GROMO-363).
 *
 * <p>심는 쪽({@code JwtFilter}) 하나와 읽는 쪽({@link LoginUserArgumentResolver}·{@code TraceIdFilter}) 둘이
 * 이 상수를 공유한다. 각자 문자열 리터럴을 들고 있으면 한쪽 오타가 컴파일을 통과해 런타임에야 드러나므로
 * 키 정의를 한 곳으로 모은다. 어느 참여자에도 속하지 않는 중립 위치라는 점이 요지다.</p>
 */
public final class AuthAttributes {

    /** JwtFilter 가 인증 성공 시 심는 사용자 PK (UUID). */
    public static final String USER_ID = "userId";

    private AuthAttributes() {
    }
}
