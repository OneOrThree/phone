package com.oneorthree.phone.auth.dto.res;

/**
 * 게스트 로그인 응답.
 *
 * @param accessToken {@code /api/*} 호출에 쓰는 짧은 수명의 토큰
 * @param refreshToken 갱신용 토큰. 게스트는 만료되면 돌아갈 계정이 없어(재로그인이 곧 새 계정이다)
 *                     소셜보다 긴 수명으로 발급된다
 * @param isNewUser 게스트 로그인은 언제나 새 User 를 만들므로 실질적으로 항상 true 다
 */
public record GuestLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
