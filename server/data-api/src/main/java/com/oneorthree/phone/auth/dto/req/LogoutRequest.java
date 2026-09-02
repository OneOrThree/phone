package com.oneorthree.phone.auth.dto.req;

/**
 * 로그아웃 요청.
 *
 * @param refreshToken 무효화할 <b>refresh</b> 토큰. access 토큰을 보내면 타입 가드에 걸려 거절된다 —
 *                     탈취한 access 토큰으로 남의 세션을 끊지 못하게 하는 장치다
 */
public record LogoutRequest(String refreshToken) {
}
