package com.oneorthree.phone.auth.support;

import com.oneorthree.phone.auth.repository.domain.LoginTokenMaterials;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 고정 서명 재료로 <b>원 토큰이 바이트까지 되살아나는지</b> 확인한다 (GROMO-1908, 계정 LLD §3).
 *
 * <h2>왜 바이트 동일성인가</h2>
 * 로그인 시도 원장은 토큰 원문을 저장하지 않는다 — 대신 재료를 남기고 재생 때 다시 서명한다. 이
 * 설계는 <b>재서명이 원본과 정확히 같을 때만</b> 성립한다. 한 글자라도 다르면 그 RT 의 SHA-256 이
 * {@code auth_sessions.refresh_token_hash} 와 어긋나, 앱이 받은 RT 로 refresh 가 되지 않는다.
 * 「같은 결과 재생」이 아니라 조용한 세션 파손이다.
 *
 * <p>JJWT 는 claim 을 <b>삽입 순서대로</b> 직렬화하므로, {@code buildToken} 의 순서가 바뀌면 값이
 * 같아도 문자열이 달라진다. 그 드리프트를 잡는 것이 이 테스트의 일이다 — 두 메서드를 같은 클래스에
 * 둔 것만으로는 막히지 않는다.
 */
class LoginAttemptReplayTest {

    private static final String SECRET = "test-secret-key-that-is-at-least-256-bits-long-for-hmac-sha256";
    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000001908");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000001908");

    private final JwtProvider jwtProvider = new JwtProvider(SECRET, 3600, 2_592_000, 7_776_000);

    /** 지금 발급기가 만드는 모양 — {@code gen}·{@code sid} 가 실린 AT + jti 를 가진 RT. */
    @Test
    void replaysSessionTokensByteForByte() {
        String access = jwtProvider.generateAccessToken(USER, false, 3, SESSION);
        String refresh = jwtProvider.generateRefreshToken(USER, false);

        LoginTokenMaterials materials = jwtProvider.freezeMaterials(access, refresh);

        assertThat(jwtProvider.replayAccessToken(USER, SESSION, materials)).isEqualTo(access);
        assertThat(jwtProvider.replayRefreshToken(USER, materials)).isEqualTo(refresh);
    }

    /**
     * {@code gen}·{@code sid} 가 «없는» 구 발급 경로의 토큰도 그대로 되살아나야 한다.
     *
     * <p>없는 claim 을 현재 값으로 채우면 재생 토큰이 원본과 달라진다 — 그게 A22 ㊍ 가 금지하는
     * 「없음을 현재 값으로 채우기」이고, 여기서는 곧바로 세션 파손으로 드러난다.
     */
    @Test
    void replaysLegacyTokensWithoutGenerationOrSession() {
        String access = jwtProvider.generateAccessToken(USER, true);
        String refresh = jwtProvider.generateRefreshToken(USER, true);

        LoginTokenMaterials materials = jwtProvider.freezeMaterials(access, refresh);

        assertThat(materials.authGeneration()).isNull();
        assertThat(materials.guest()).isTrue();
        assertThat(jwtProvider.replayAccessToken(USER, null, materials)).isEqualTo(access);
        assertThat(jwtProvider.replayRefreshToken(USER, materials)).isEqualTo(refresh);
    }

    /**
     * 재료를 «다시 발급» 으로 대체할 수 없다는 것을 고정한다.
     *
     * <p>RT 의 {@code jti} 는 매 발급마다 무작위다. 재생이 그냥 새로 발급하는 구현이었다면 두 토큰이
     * 달랐을 것이고, 저장된 해시와 어긋났을 것이다 — 이 단언이 그 구현을 거부한다.
     */
    @Test
    void reissuingInsteadOfReplayingProducesADifferentRefreshToken() {
        String refresh = jwtProvider.generateRefreshToken(USER, false);
        assertThat(jwtProvider.generateRefreshToken(USER, false)).isNotEqualTo(refresh);
    }
}
