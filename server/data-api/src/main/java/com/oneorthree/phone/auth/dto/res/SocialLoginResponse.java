package com.oneorthree.phone.auth.dto.res;

/**
 * 소셜 로그인 응답 — 신규 가입·기존 로그인·게스트 승격 세 경로가 모두 이 형태로 나온다.
 *
 * @param accessToken {@code /api/*} 호출에 쓰는 짧은 수명의 토큰
 * @param refreshToken 갱신용 토큰. 로그인마다 새로 발급되며 저장된 해시를 덮어쓰므로,
 *                     이 시점에 다른 기기가 쥔 refresh 토큰은 무효가 된다
 * @param isNewUser true 면 이번 호출로 계정이 처음 만들어졌다는 뜻이라 앱이 온보딩(닉네임 입력)으로
 *                  보내야 한다. 게스트 승격은 계정을 새로 만들지 않는다
 */
public record SocialLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
}
