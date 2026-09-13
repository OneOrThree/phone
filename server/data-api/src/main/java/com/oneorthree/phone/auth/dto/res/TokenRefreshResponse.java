package com.oneorthree.phone.auth.dto.res;

import java.util.UUID;

/**
 * 토큰 재발급 응답.
 *
 * <p>{@code refreshToken} 은 <b>회전이 일어난 경우에만</b> 채워진다 (GROMO-1509). 남은 수명이
 * 넉넉하면 null 이고, 클라이언트는 값이 있을 때만 저장소를 갱신한다(앱 {@code api.ts} 의
 * {@code if (data.refreshToken)}). 매 갱신마다 갈아끼우지 않는 이유는
 * {@code JwtProvider.isRefreshRotationDue} 주석 참고.
 *
 * @param accessToken    새 access 토큰
 * @param refreshToken   회전이 일어났을 때만 채워지는 새 refresh 토큰
 * @param sessionId      이 토큰이 속한 로그인 세션 (A22 ㋞) — <b>additive</b> 다. 세션 행이 없는 구
 *                       RT 는 {@code null} 이고, 그때는 AT 에도 {@code sid} 가 실리지 않는다(㋪)
 * @param deviceBootstrap 이 세션의 1회용 자격 — <b>자격이 없던 세션에 처음 생길 때만</b> 채워진다.
 *                       회전마다 새로 발급하면 그 응답이 유실됐을 때 앱이 든 값이 영구히 낡아,
 *                       세션 확인이 되던 기기가 오히려 확인 없는 경로로 떨어진다
 */
public record TokenRefreshResponse(
        String accessToken,
        String refreshToken,
        UUID sessionId,
        String deviceBootstrap) {

    /**
     * 세션 값 없이 만드는 형태 — 기존 호출부·테스트를 그대로 두기 위한 additive 보조 생성자다.
     *
     * @param accessToken  access 토큰
     * @param refreshToken 회전된 refresh 토큰. 회전이 없으면 {@code null}
     */
    public TokenRefreshResponse(String accessToken, String refreshToken) {
        this(accessToken, refreshToken, null, null);
    }
}
