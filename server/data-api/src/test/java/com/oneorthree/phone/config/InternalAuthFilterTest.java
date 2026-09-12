package com.oneorthree.phone.config;

import com.oneorthree.phone.common.auth.AuthAttributes;
import com.oneorthree.phone.internal.InternalUserController;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 내부 표면의 관문 (A22 ㉸ · ㉱ · ㊀).
 *
 * <p>여기서 지키는 네 가지는 전부 <b>실패하면 남의 데이터</b>가 되는 것들이다 — 배선되지 않은 표면이
 * 열리는 것, 모르는 토큰이 통과하는 것, 허용목록 밖 경로가 열리는 것, 경로의 대상과 헤더의 주체가
 * 다른 요청이 통과하는 것.
 */
class InternalAuthFilterTest {

    private static final String BUSINESS_TOKEN = "svc-biz-to-data";
    private static final String NOTI_TOKEN = "svc-noti-to-data";

    private static InternalApiProperties enabledProperties() {
        InternalApiProperties properties = new InternalApiProperties();
        properties.setEnabled(true);
        InternalApiProperties.Caller business = new InternalApiProperties.Caller();
        business.setToken(BUSINESS_TOKEN);
        business.setAllow(List.of(
                "GET /internal/users/*/activation",
                "POST /internal/users/*/device-token-deletions"));
        properties.getCallers().put("business", business);
        InternalApiProperties.Caller notification = new InternalApiProperties.Caller();
        notification.setToken(NOTI_TOKEN);
        notification.setAllow(List.of("GET /internal/users/*/result-ack"));
        properties.getCallers().put("notification", notification);
        return properties;
    }

    private static MockHttpServletRequest request(String method, String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.setRequestURI(uri);
        return request;
    }

    private static MockHttpServletResponse run(InternalApiProperties properties,
            MockHttpServletRequest request, MockFilterChain chain) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        new InternalAuthFilter(properties).doFilter(request, response, chain);
        return response;
    }

    @Test
    @DisplayName("배선되지 않은 표면은 «없는» 표면이다 — 401 이면 「자격만 맞추면 열린다」는 신호가 된다")
    void disabledSurfaceIsNotFound() throws Exception {
        UUID userId = UUID.randomUUID();
        MockHttpServletRequest request = request("GET", "/internal/users/" + userId + "/activation");
        request.addHeader("Authorization", "Bearer " + BUSINESS_TOKEN);
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(new InternalApiProperties(), request, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_NOT_FOUND);
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    @DisplayName("정상 호출은 통과하고 주체를 request 에 심는다")
    void passesValidCall() throws Exception {
        UUID userId = UUID.randomUUID();
        MockHttpServletRequest request = request("GET", "/internal/users/" + userId + "/activation");
        request.addHeader("Authorization", "Bearer " + BUSINESS_TOKEN);
        request.addHeader("X-User-Id", userId.toString());
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(enabledProperties(), request, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(chain.getRequest()).isNotNull();
        assertThat(request.getAttribute(AuthAttributes.USER_ID)).isEqualTo(userId);
        assertThat(request.getAttribute(InternalCallAttributes.CALLER)).isEqualTo("business");
    }

    @Test
    @DisplayName("모르는 토큰은 «코드 없는» 401 이다 — 도메인 코드를 실으면 정상 세션이 재로그인으로 튄다")
    void rejectsUnknownToken() throws Exception {
        UUID userId = UUID.randomUUID();
        MockHttpServletRequest request = request("GET", "/internal/users/" + userId + "/activation");
        request.addHeader("Authorization", "Bearer nope");
        request.addHeader("X-User-Id", userId.toString());
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(enabledProperties(), request, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        assertThat(response.getContentAsString()).isEmpty();
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    @DisplayName("caller 별 허용목록이 실제로 갈린다 — 알림 자격으로 Business 명령에 닿지 못한다")
    void allowlistIsPerCaller() throws Exception {
        UUID userId = UUID.randomUUID();
        MockHttpServletRequest request =
                request("POST", "/internal/users/" + userId + "/device-token-deletions");
        request.addHeader("Authorization", "Bearer " + NOTI_TOKEN);
        request.addHeader("X-User-Id", userId.toString());
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(enabledProperties(), request, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_FORBIDDEN);
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    @DisplayName("허용목록에 없는 method 는 막는다 — 같은 경로라도 method 가 계약이다")
    void rejectsMethodOutsideAllowlist() throws Exception {
        UUID userId = UUID.randomUUID();
        MockHttpServletRequest request = request("POST", "/internal/users/" + userId + "/activation");
        request.addHeader("Authorization", "Bearer " + BUSINESS_TOKEN);
        request.addHeader("X-User-Id", userId.toString());
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(enabledProperties(), request, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_FORBIDDEN);
    }

    @Test
    @DisplayName("«경로의 대상 ≠ 헤더의 주체»는 통과하지 못한다 — 통과하면 그 순간 남의 데이터다")
    void rejectsUserIdMismatch() throws Exception {
        UUID pathUser = UUID.randomUUID();
        MockHttpServletRequest request = request("GET", "/internal/users/" + pathUser + "/activation");
        request.addHeader("Authorization", "Bearer " + BUSINESS_TOKEN);
        request.addHeader("X-User-Id", UUID.randomUUID().toString());
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(enabledProperties(), request, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_FORBIDDEN);
        assertThat(chain.getRequest()).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "12345678-1234-4234-8234-123456789abc;ignored=yes",
        "%312345678-1234-4234-8234-123456789abc"
    })
    @DisplayName("MVC가 정규화하는 사용자 경로로 주체 대조를 우회할 수 없다")
    void rejectsNonCanonicalUserPathsBeforeMvc(String segment) throws Exception {
        UserSatelliteCommandService service = mock(UserSatelliteCommandService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new InternalUserController(service))
                .addFilters(new InternalAuthFilter(enabledProperties())).build();

        mvc.perform(get(URI.create("/internal/users/" + segment + "/activation"))
                        .header("Authorization", "Bearer " + BUSINESS_TOKEN)
                        .header("X-User-Id", UUID.randomUUID().toString()))
                .andExpect(status().isForbidden());

        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("사용자 하위 경로의 깨진 UUID를 서비스 전용 요청으로 통과시키지 않는다")
    void rejectsMalformedUserPath() throws Exception {
        MockHttpServletRequest request = request("GET", "/internal/users/not-a-uuid/activation");
        request.addHeader("Authorization", "Bearer " + BUSINESS_TOKEN);
        request.addHeader("X-User-Id", UUID.randomUUID().toString());
        MockFilterChain chain = new MockFilterChain();

        assertThat(run(enabledProperties(), request, chain).getStatus())
                .isEqualTo(HttpServletResponse.SC_FORBIDDEN);
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    @DisplayName("계약에 명시된 유저 스냅샷은 사용자 헤더 없는 컬렉션 조회를 유지한다")
    void passesUserSnapshotWithoutDelegatedUser() throws Exception {
        InternalApiProperties properties = enabledProperties();
        properties.getCallers().get("notification")
                .setAllow(List.of("GET /internal/users/notification-snapshot"));
        MockHttpServletRequest request = request("GET", "/internal/users/notification-snapshot");
        request.addHeader("Authorization", "Bearer " + NOTI_TOKEN);
        MockFilterChain chain = new MockFilterChain();

        assertThat(run(properties, request, chain).getStatus()).isEqualTo(HttpServletResponse.SC_OK);
        assertThat(chain.getRequest()).isNotNull();
    }

    @Test
    @DisplayName("유저 경로인데 헤더가 없으면 막는다 — 「없으면 통과」가 곧 인증 우회다")
    void rejectsMissingUserHeaderOnUserScopedPath() throws Exception {
        UUID pathUser = UUID.randomUUID();
        MockHttpServletRequest request = request("GET", "/internal/users/" + pathUser + "/activation");
        request.addHeader("Authorization", "Bearer " + BUSINESS_TOKEN);
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(enabledProperties(), request, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_FORBIDDEN);
    }

    @Test
    @DisplayName("X-User-Id 가 UUID 가 아니면 400 — 조용히 무시하면 그 요청이 서비스 전용처럼 통과한다")
    void rejectsMalformedUserHeader() throws Exception {
        UUID pathUser = UUID.randomUUID();
        MockHttpServletRequest request = request("GET", "/internal/users/" + pathUser + "/activation");
        request.addHeader("Authorization", "Bearer " + BUSINESS_TOKEN);
        request.addHeader("X-User-Id", "not-a-uuid");
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(enabledProperties(), request, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_BAD_REQUEST);
    }

    @Test
    @DisplayName("* 는 한 segment 만 먹는다 — 허용목록이 아래 경로를 통째로 삼키지 않는다")
    void singleStarDoesNotSwallowDeeperPaths() throws Exception {
        UUID userId = UUID.randomUUID();
        MockHttpServletRequest request =
                request("GET", "/internal/users/" + userId + "/activation/secret");
        request.addHeader("Authorization", "Bearer " + BUSINESS_TOKEN);
        request.addHeader("X-User-Id", userId.toString());
        MockFilterChain chain = new MockFilterChain();

        MockHttpServletResponse response = run(enabledProperties(), request, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_FORBIDDEN);
    }
}
