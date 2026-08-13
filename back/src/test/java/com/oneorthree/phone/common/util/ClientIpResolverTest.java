package com.oneorthree.phone.common.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * prod 토폴로지는 Cloudflare → nginx → app 이고, 신뢰하는 헤더는 {@code X-Real-IP} 하나다.
 * nginx 가 {@code set_real_ip_from}(CF 대역) + {@code proxy_set_header X-Real-IP $remote_addr} 로
 * 항상 덮어쓰기 때문에 위조가 안 된다. {@code CF-Connecting-IP}·XFF 는 nginx 를 그대로 통과하므로
 * 오리진에 직접 붙으면 호출자가 값을 고를 수 있어 레이트리밋 키로 쓸 수 없다.
 */
class ClientIpResolverTest {

    private final ClientIpResolver resolver = new ClientIpResolver(List.of("X-Real-IP"));

    @Test
    @DisplayName("X-Real-IP 를 쓴다 — nginx 가 매 요청 덮어쓰는 유일한 위조 불가 헤더")
    void usesRealIpHeader() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Real-IP", "1.1.1.1");
        request.setRemoteAddr("10.0.0.1");

        assertThat(resolver.resolve(request)).isEqualTo("1.1.1.1");
    }

    @Test
    @DisplayName("신뢰 목록에 없는 헤더는 값이 있어도 안 읽는다 — 호출자가 지어낼 수 있는 헤더들")
    void untrustedHeadersAreIgnored() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("CF-Connecting-IP", "1.1.1.1");
        request.addHeader("X-Forwarded-For", "9.9.9.9");
        request.setRemoteAddr("10.0.0.1");

        assertThat(resolver.resolve(request)).isEqualTo("10.0.0.1");
    }

    @Test
    @DisplayName("목록 순서대로 먼저 잡히는 헤더를 쓴다")
    void firstConfiguredHeaderWins() {
        ClientIpResolver multi = new ClientIpResolver(List.of("X-Real-IP", "X-Forwarded-For"));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Forwarded-For", "2.2.2.2, 10.0.0.5, 10.0.0.6");
        request.setRemoteAddr("10.0.0.1");

        // X-Real-IP 가 없으면 XFF 첫 토큰(= 원 클라이언트 자리)으로 내려간다
        assertThat(multi.resolve(request)).isEqualTo("2.2.2.2");
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
        request.addHeader("X-Real-IP", "  ");
        request.setRemoteAddr("10.0.0.1");

        assertThat(resolver.resolve(request)).isEqualTo("10.0.0.1");
    }

    @Test
    @DisplayName("신뢰 헤더 목록을 비우면 헤더를 무시하고 remoteAddr 만 쓴다 — 앞단 프록시가 없는 dev 용")
    void emptyTrustListIgnoresHeaders() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Real-IP", "1.1.1.1");
        request.setRemoteAddr("10.0.0.1");

        assertThat(new ClientIpResolver(List.of()).resolve(request)).isEqualTo("10.0.0.1");
    }

    @Test
    @DisplayName("피어가 공인 IP 면 전달 헤더를 무시한다 — 오리진 직접 노출 시 헤더 위조로 신원을 고르는 걸 막는다")
    void publicPeerCannotForgeHeaders() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Real-IP", "1.1.1.1");
        request.setRemoteAddr("203.0.113.7");

        assertThat(resolver.resolve(request)).isEqualTo("203.0.113.7");
    }

    @Test
    @DisplayName("루프백 피어는 프록시로 인정한다 — 같은 호스트 nginx 구성")
    void loopbackPeerIsTrusted() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Real-IP", "1.1.1.1");
        request.setRemoteAddr("127.0.0.1");

        assertThat(resolver.resolve(request)).isEqualTo("1.1.1.1");
    }

    @Test
    @DisplayName("remoteAddr 조차 없으면 unknown — 해시 입력이 null 이 되어 터지지 않게 한다")
    void unknownWhenNothingAvailable() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr(null);

        assertThat(resolver.resolve(request)).isEqualTo("unknown");
    }
}
