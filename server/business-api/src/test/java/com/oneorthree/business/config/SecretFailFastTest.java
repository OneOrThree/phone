package com.oneorthree.business.config;

import com.oneorthree.business.auth.AccessTokenVerifier;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.common.http.IpHasher;
import com.oneorthree.business.common.http.UpstreamProperties;
import com.oneorthree.business.common.http.UpstreamTarget;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 필수 시크릿·주소가 비면 <b>부팅에서 실패</b>한다.
 *
 * <p>왜 런타임이 아니라 부팅인가: 빈 서비스 토큰으로 뜨면 상류가 전부 401 을 주고, 그 401 은 운영에서
 * 「인증 장애」로 보인다 — 원인이 시크릿 미주입이라는 사실이 가려진다. 빈 주소도 마찬가지로 「어딘가로
 * 조용히 나가는」 상태를 만든다.
 */
@DisplayName("prod 필수 시크릿 fail-fast")
class SecretFailFastTest {

    private static UpstreamProperties props(String baseUrl, String token) {
        return new UpstreamProperties(baseUrl, token, Duration.ofMillis(200), Duration.ofMillis(200),
                3, Duration.ofSeconds(5));
    }

    @Test
    @DisplayName("서비스 토큰이 비면 생성자가 던진다")
    void 토큰없음() {
        assertThatThrownBy(() -> new InternalHttpClient(
                UpstreamTarget.DATA, props("http://x", "  "), new ObjectMapper()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("service-token");
    }

    @Test
    @DisplayName("base-url 이 비면 생성자가 던진다")
    void 주소없음() {
        assertThatThrownBy(() -> new InternalHttpClient(
                UpstreamTarget.NOTIFICATION, props("", "token"), new ObjectMapper()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("base-url");
    }

    @Test
    @DisplayName("치환되지 않은 ${...} 플레이스홀더도 거절한다 — blank 검사만으로는 못 막는다")
    void 치환되지않은플레이스홀더() {
        // ⚠️ 이건 가설이 아니다. 이 이미지를 SVC_TOKEN_BIZ_TO_LINK 없이 띄웠을 때 Spring 이 값을
        //    리터럴 "${SVC_TOKEN_BIZ_TO_LINK}" 로 남기고 «Started BusinessApplication» 까지 갔다.
        //    그 리터럴이 Bearer 토큰으로 나가면 상류가 전부 401 을 주고 「인증 장애」로 오진된다.
        assertThatThrownBy(() -> new InternalHttpClient(
                UpstreamTarget.LINK, props("http://x", "${SVC_TOKEN_BIZ_TO_LINK}"), new ObjectMapper()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("치환되지 않았다")
                // 변수 «이름» 을 메시지에 담는다 — 치환되지 않았으므로 비밀이 아니고,
                // 어느 env 키가 전달되지 않았는지 바로 알려 준다.
                .hasMessageContaining("SVC_TOKEN_BIZ_TO_LINK");
    }

    @Test
    @DisplayName("base-url 도 플레이스홀더면 거절한다 — 리터럴 주소로 뜨면 연결 실패가 「상류 장애」로 보인다")
    void 주소플레이스홀더() {
        assertThatThrownBy(() -> new InternalHttpClient(
                UpstreamTarget.DATA, props("${DATA_API_BASE_URL}", "token"), new ObjectMapper()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DATA_API_BASE_URL");
    }

    @Test
    @DisplayName("jwt.secret 이 플레이스홀더면 거절한다 — 그 리터럴은 32바이트를 넘어 HS256 키로 «성립»한다")
    void 서명키플레이스홀더() {
        assertThatThrownBy(() -> new AccessTokenVerifier("${JWT_SECRET}"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("치환되지 않았다");
    }

    @Test
    @DisplayName("link.ip-salt 이 플레이스홀더면 거절한다 — 그 값으로 해싱하면 매치가 조용히 전멸한다")
    void salt플레이스홀더() {
        assertThatThrownBy(() -> new IpHasher("${LINK_IP_SALT}"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("LINK_IP_SALT");
    }
}
