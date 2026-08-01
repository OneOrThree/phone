package com.oneorthree.phone.invitelink.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * prod 토폴로지는 Cloudflare → nginx → app 이다. 그래서 신뢰 순서가 곧 정확도다 —
 * XFF 를 먼저 믿으면 클라이언트가 헤더를 위조해 매치 fingerprint 를 조작할 수 있고,
 * remoteAddr 만 믿으면 전부 nginx IP 로 뭉쳐 모든 클릭이 서로 매치된다.
 */
class ClientIpResolverTest {

    private final ClientIpResolver resolver =
            new ClientIpResolver(List.of("CF-Connecting-IP", "X-Forwarded-For"));

    @Test
    @DisplayName("CF-Connecting-IP 가 XFF 보다 우선한다")
    void cloudflareHeaderWins() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("CF-Connecting-IP", "1.1.1.1");
        request.addHeader("X-Forwarded-For", "9.9.9.9");
        request.setRemoteAddr("10.0.0.1");

        assertThat(resolver.resolve(request)).isEqualTo("1.1.1.1");
    }

    @Test
    @DisplayName("CF 헤더가 없으면 XFF 의 첫 토큰을 쓴다")
    void fallsBackToFirstForwardedToken() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Forwarded-For", "2.2.2.2, 10.0.0.5, 10.0.0.6");
        request.setRemoteAddr("10.0.0.1");

        assertThat(resolver.resolve(request)).isEqualTo("2.2.2.2");
    }

    @Test
    @DisplayName("헤더가 없으면 remoteAddr 을 쓴다")
    void fallsBackToRemoteAddr() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.1");

        assertThat(resolver.resolve(request)).isEqualTo("10.0.0.1");
    }

    @Test
    @DisplayName("빈 문자열 헤더는 없는 것으로 취급한다")
    void blankHeadersAreIgnored() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("CF-Connecting-IP", "  ");
        request.addHeader("X-Forwarded-For", "");
        request.setRemoteAddr("10.0.0.1");

        assertThat(resolver.resolve(request)).isEqualTo("10.0.0.1");
    }

    @Test
    @DisplayName("신뢰 헤더 목록을 비우면 헤더를 무시하고 remoteAddr 만 쓴다 — 오리진이 직접 열린 환경용")
    void emptyTrustListIgnoresHeaders() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("CF-Connecting-IP", "1.1.1.1");
        request.addHeader("X-Forwarded-For", "9.9.9.9");
        request.setRemoteAddr("10.0.0.1");

        assertThat(new ClientIpResolver(List.of()).resolve(request)).isEqualTo("10.0.0.1");
    }

    @Test
    @DisplayName("remoteAddr 조차 없으면 unknown — 해시 입력이 null 이 되어 터지지 않게 한다")
    void unknownWhenNothingAvailable() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr(null);

        assertThat(resolver.resolve(request)).isEqualTo("unknown");
    }
}
