package com.oneorthree.phone.auth.dto.res;

import java.util.UUID;

/**
 * 게스트 로그인 응답.
 *
 * @param accessToken {@code /api/*} 호출에 쓰는 짧은 수명의 토큰
 * @param refreshToken 갱신용 토큰. 게스트는 만료되면 돌아갈 계정이 없어(재로그인이 곧 새 계정이다)
 *                     소셜보다 긴 수명으로 발급된다
 * @param isNewUser 게스트 로그인은 언제나 새 User 를 만들므로 실질적으로 항상 true 다
 * @param deviceBootstrap 이 로그인 세션의 1회용 자격 (A22 ㋞) — <b>additive</b> 다. 응답 이후 다시
 *                        내려주지 않으므로 앱이 보관했다가 기기 토큰 등록에 실어 보낸다. 현 앱은 이
 *                        필드를 모르고 무시하며, 그때는 세션 확인 없이 «검사 없이 수락» 단계로 동작한다
 * @param sessionId 이 토큰이 속한 로그인 세션 (A22 ㋞) — <b>additive</b> 다. 개별 기기 로그아웃이
 *                  「어느 세션인가」를 가리키는 값이고 AT 의 {@code sid} claim 과 같다
 */
public record GuestLoginResponse(
        String accessToken,
        String refreshToken,
        boolean isNewUser,
        String deviceBootstrap,
        UUID sessionId) {

    /**
     * 세션 자격 없이 만드는 형태 — 기존 호출부·테스트를 그대로 두기 위한 additive 보조 생성자다.
     *
     * @param accessToken  access 토큰
     * @param refreshToken refresh 토큰
     * @param isNewUser    신규 가입 여부
     */
    public GuestLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
        this(accessToken, refreshToken, isNewUser, null, null);
    }
}
