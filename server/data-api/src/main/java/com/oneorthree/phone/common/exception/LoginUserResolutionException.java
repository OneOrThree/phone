package com.oneorthree.phone.common.exception;

import com.oneorthree.phone.common.auth.LoginUser;

/**
 * {@link LoginUser} 파라미터를 채우지 못했을 때 던진다 (GROMO-363).
 *
 * <p>클라이언트가 고칠 수 있는 문제가 아니라 <b>서버 배선 오류</b>다. 두 가지 경우뿐이다.</p>
 * <ul>
 *   <li>JwtFilter 를 타지 않는 경로(WHITELIST 등)에 {@code @LoginUser} 를 붙였다 — request attribute 가 비어 있다.</li>
 *   <li>{@code @LoginUser} 를 UUID 가 아닌 타입에 붙였다.</li>
 * </ul>
 *
 * <p>전용 예외로 둔 이유는 {@code GlobalExceptionHandler} 가 표준 {@code ErrorResponse} 형식으로
 * 500 을 내려주게 하기 위해서다. 일반 {@code IllegalStateException} 으로 던지면 매칭되는 핸들러가 없어
 * 스프링 기본 {@code /error} 응답으로 새고, 그러면 이 API 의 에러 규약({@code code}/{@code message})이 깨진다.</p>
 */
public class LoginUserResolutionException extends RuntimeException {

    public LoginUserResolutionException(String message) {
        super(message);
    }
}
