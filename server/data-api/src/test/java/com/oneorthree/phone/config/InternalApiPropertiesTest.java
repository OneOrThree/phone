package com.oneorthree.phone.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 내부 표면 설정의 <b>기동 검증</b> (A22 ㊀ · ㉱).
 *
 * <p>여기서 죽는 편이 낫다 — 빈 토큰으로 뜨면 그 자체가 「자격 없이 열린 내부 명령」이고, 그 사실은
 * 사고가 난 뒤에야 드러난다.
 */
class InternalApiPropertiesTest {

    private static InternalApiProperties.Caller caller(String token, String... allow) {
        InternalApiProperties.Caller caller = new InternalApiProperties.Caller();
        caller.setToken(token);
        caller.setAllow(List.of(allow));
        return caller;
    }

    @Test
    @DisplayName("꺼져 있으면 아무 값도 요구하지 않는다")
    void disabledRequiresNothing() {
        assertThatCode(() -> new InternalApiProperties().validateWhenEnabled()).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("켰는데 caller 가 없으면 기동을 거부한다")
    void enabledWithoutCallersFails() {
        InternalApiProperties properties = new InternalApiProperties();
        properties.setEnabled(true);

        assertThatThrownBy(properties::validateWhenEnabled)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("caller");
    }

    @Test
    @DisplayName("빈 토큰·빈 허용목록은 기동을 거부한다")
    void blankCredentialsFail() {
        InternalApiProperties blankToken = new InternalApiProperties();
        blankToken.setEnabled(true);
        blankToken.getCallers().put("business", caller(" ", "GET /internal/users/*/activation"));
        assertThatThrownBy(blankToken::validateWhenEnabled).isInstanceOf(IllegalStateException.class);

        InternalApiProperties emptyAllow = new InternalApiProperties();
        emptyAllow.setEnabled(true);
        emptyAllow.getCallers().put("business", caller("t"));
        assertThatThrownBy(emptyAllow::validateWhenEnabled).isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("토큰이 겹치면 두 caller 의 권한이 사실상 합쳐진다 — 기동에서 막는다")
    void duplicateTokensFail() {
        InternalApiProperties properties = new InternalApiProperties();
        properties.setEnabled(true);
        properties.getCallers().put("business", caller("same", "GET /internal/users/*/activation"));
        properties.getCallers().put("notification", caller("same", "GET /internal/users/*/result-ack"));

        assertThatThrownBy(properties::validateWhenEnabled)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("겹칩");
    }

    @ParameterizedTest
    @ValueSource(strings = {" same", "same ", "\tsame\t", "\nsame\n"})
    @DisplayName("앞뒤 공백으로만 다른 caller 토큰은 기동에서 거절한다")
    void paddedTokensFailBeforeCallerResolution(String padded) {
        InternalApiProperties properties = new InternalApiProperties();
        properties.setEnabled(true);
        properties.getCallers().put("business", caller("same", "GET /internal/users/*/activation"));
        properties.getCallers().put("notification", caller(padded, "GET /internal/users/*/result-ack"));

        assertThatThrownBy(properties::validateWhenEnabled)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("공백");
    }

    @Test
    @DisplayName("/internal 밖 경로는 허용목록에 넣을 수 없다 — 앱 JWT 경로를 서비스 토큰으로 여는 길이 생긴다")
    void allowlistCannotLeaveInternalPrefix() {
        InternalApiProperties properties = new InternalApiProperties();
        properties.setEnabled(true);
        properties.getCallers().put("business", caller("t", "GET /api/v1/users/me"));

        assertThatThrownBy(properties::validateWhenEnabled)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("/internal/");
    }

    @Test
    @DisplayName("형식이 어긋난 허용 항목은 기동에서 막는다")
    void malformedAllowEntryFails() {
        InternalApiProperties properties = new InternalApiProperties();
        properties.setEnabled(true);
        properties.getCallers().put("business", caller("t", "/internal/users/*/activation"));

        assertThatThrownBy(properties::validateWhenEnabled).isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("실제 satellites 프로파일과 같은 모양은 통과한다")
    void realShapePasses() {
        InternalApiProperties properties = new InternalApiProperties();
        properties.setEnabled(true);
        properties.getCallers().put("business", caller("biz",
                "GET /internal/users/*/activation",
                "POST /internal/auth/device-sessions/verify",
                "POST /internal/outbox-commands/*/delivered",
                "GET /internal/migrations/*/invite-link-clicks/candidates"));
        properties.getCallers().put("notification", caller("noti", "GET /internal/users/*/result-ack"));

        assertThatCode(properties::validateWhenEnabled).doesNotThrowAnyException();
    }
}
