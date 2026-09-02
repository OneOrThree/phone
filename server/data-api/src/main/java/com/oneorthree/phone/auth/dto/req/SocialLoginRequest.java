package com.oneorthree.phone.auth.dto.req;

/**
 * 애플을 제외한 소셜 로그인 공통 요청 본문.
 *
 * @param token 제공자가 발급한 토큰. 무엇이 오는지는 엔드포인트마다 다르다 —
 *              구글·페이스북은 OIDC id_token, 카카오·라인·인스타그램은 액세스 토큰이다
 */
public record SocialLoginRequest(String token) {
}
