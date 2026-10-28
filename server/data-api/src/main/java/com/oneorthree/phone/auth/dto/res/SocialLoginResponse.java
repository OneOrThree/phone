package com.oneorthree.phone.auth.dto.res;

import java.util.UUID;

/**
 * 소셜 로그인 응답 — 신규 가입·기존 로그인·게스트 승격 세 경로가 모두 이 형태로 나온다.
 *
 * @param accessToken {@code /api/*} 호출에 쓰는 짧은 수명의 토큰
 * @param refreshToken 갱신용 토큰. 로그인마다 새로 발급되며 저장된 해시를 덮어쓰므로,
 *                     이 시점에 다른 기기가 쥔 refresh 토큰은 무효가 된다
 * @param isNewUser true 면 이번 호출로 계정이 처음 만들어졌다는 뜻이라 앱이 온보딩(닉네임 입력)으로
 *                  보내야 한다. 게스트 승격은 계정을 새로 만들지 않는다
 * @param deviceBootstrap 이 로그인 세션의 1회용 자격 (A22 ㋞) — <b>additive</b> 다. 응답 이후 다시
 *                        내려주지 않으므로 앱이 보관했다가 기기 토큰 등록에 실어 보낸다. 현 앱은 이
 *                        필드를 모르고 무시하며, 그때는 세션 확인 없이 «검사 없이 수락» 단계로 동작한다
 * @param sessionId 이 토큰이 속한 로그인 세션 (A22 ㋞) — <b>additive</b> 다. 개별 기기 로그아웃이
 *                  「어느 세션인가」를 가리키는 값이고 AT 의 {@code sid} claim 과 같다
 */
public record SocialLoginResponse(
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
    public SocialLoginResponse(String accessToken, String refreshToken, boolean isNewUser) {
        this(accessToken, refreshToken, isNewUser, null, null);
    }
}
