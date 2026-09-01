package com.oneorthree.phone.auth.dto.req;

/**
 * 애플 로그인 요청 — 다른 제공자와 달리 필드가 셋이다. 애플이 이름을 <b>최초 인증 1회에만</b>
 * 내려 주기 때문에 앱이 그때 받은 값을 함께 실어 보낸다.
 *
 * @param identityToken 서버가 JWKS 로 검증할 OIDC id_token. 실질적인 인증 재료는 이것 하나다
 * @param authorizationCode 애플 서버와 직접 토큰 교환을 할 때 쓰는 일회용 코드.
 *                          현재 서버는 identityToken 로컬 검증만 하므로 받아 두기만 한다
 * @param fullName 애플이 최초 1회 준 이름. <b>닉네임으로 쓰지 않는다</b> —
 *                 {@code users.nickname} 유니크 제약과 동명이인이 충돌해 제거된 경로다
 */
public record AppleLoginRequest(String identityToken, String authorizationCode, String fullName) {
}
