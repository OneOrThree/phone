package com.oneorthree.business.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 컨트롤러 파라미터에 <b>검증된 AT 의 subject</b> 를 주입한다.
 *
 * <p>주입 타입은 {@link AccessTokenClaims} 또는 {@code UUID} 다. <b>요청 헤더에서 오지 않는다</b> —
 * 외부 {@code X-User-Id} 는 필터가 이미 폐기했고(A22 ㉸), 여기 들어오는 값은 서명을 검증한 토큰의
 * subject 하나뿐이다.
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface LoginUser {
}
