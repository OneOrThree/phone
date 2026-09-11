package com.oneorthree.business.common.http;

import com.oneorthree.business.auth.AuthAttributes;
import com.oneorthree.business.config.RequestEnvelopeFilter;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.UserActivation;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.Import;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 인증/봉투 필터 → facade → HTTP executor → TCP 상류 → 공개 오류 매핑을 검증한다. */
@Import(UpstreamErrorContractIntegrationTest.ProbeController.class)
class UpstreamErrorContractIntegrationTest extends UpstreamTestBase {
    private static final UUID USER = UUID.randomUUID();
    private static final String UPSTREAM = "GET /internal/users/" + USER + "/activation";
    private static final String PUBLIC = "/me/_upstream-contract";
    private static final String LEGACY = "/api/v1/_upstream-contract";

    @DynamicPropertySource
    static void retryProperties(DynamicPropertyRegistry registry) {
        registry.add("business.upstream.data.max-attempts", () -> 3);
        registry.add("business.upstream.data.failure-threshold", () -> 1000);
        registry.add("business.upstream.data.retry-delay", () -> "1ms");
    }

    @ParameterizedTest
    @CsvSource({"500,UNREGISTERED_FAILURE", "502,UNREGISTERED_FAILURE", "500,SERVICE_UNAVAILABLE",
            "503,UPSTREAM_TIMEOUT", "504,SERVICE_UNAVAILABLE"})
    void publicSynchronousUnknownOrMismatchedServerErrorsAreTerminal(int upstreamStatus, String code) throws Exception {
        structured(upstreamStatus, code);
        mockMvc.perform(get(PUBLIC + "/sync").header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("X-Strict-Error-Contract", "false"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.error.retryable").value(false));
        assertThat(DATA.hits(UPSTREAM)).isEqualTo(1);
    }

    @ParameterizedTest
    @CsvSource({"500,UNREGISTERED_FAILURE", "502,UNREGISTERED_FAILURE", "500,INTERNAL_ERROR",
            "502,UPSTREAM_CONTRACT_ERROR", "502,UPSTREAM_AUTH_FAILED"})
    void legacySynchronousServerErrorKeepsRetries(int upstreamStatus, String code) throws Exception {
        structured(upstreamStatus, code);
        mockMvc.perform(get(LEGACY + "/sync").header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("X-Strict-Error-Contract", "true"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("UPSTREAM_UNAVAILABLE"))
                .andExpect(jsonPath("$.error").doesNotExist());
        assertThat(DATA.hits(UPSTREAM)).isEqualTo(3);
    }

    @ParameterizedTest
    @CsvSource({"500,UNREGISTERED_FAILURE", "502,UNREGISTERED_FAILURE", "500,SERVICE_UNAVAILABLE",
            "503,UPSTREAM_TIMEOUT", "504,SERVICE_UNAVAILABLE"})
    void optionalCompositionPreservesStrictClassificationAcrossBothExecutors(int upstreamStatus, String code)
            throws Exception {
        structured(upstreamStatus, code);
        mockMvc.perform(get(PUBLIC + "/compose").header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.error.retryable").value(false));
        assertThat(DATA.hits(UPSTREAM)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"REFRESH_TOKEN", "UNAUTHORIZED"})
    void ordinaryInternalCallsStillTreatAuthenticationCodesAsServiceFailure(String code) throws Exception {
        structured(401, code);
        mockMvc.perform(get(PUBLIC + "/sync").header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_AUTH_FAILED"));
        assertThat(DATA.hits(UPSTREAM)).isEqualTo(1);
    }

    @Test
    void userAuthenticationErrorOptInCannotSpreadToOtherInternalRoutes() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> InternalCall
                .to(org.springframework.http.HttpMethod.POST, "/internal/auth/sessions/verify")
                .endUserAuthErrors().build()).isInstanceOf(IllegalArgumentException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> InternalCall
                .to(org.springframework.http.HttpMethod.GET, "/internal/auth/sessions/logout")
                .endUserAuthErrors().build()).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void compositionIsStrictEvenWhenStartedFromLegacyExplicitContext() throws Exception {
        structured(502, "UNREGISTERED_FAILURE");
        mockMvc.perform(get(LEGACY + "/compose").header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UNREGISTERED_FAILURE"));
        assertThat(DATA.hits(UPSTREAM)).isEqualTo(1);
    }

    @ParameterizedTest
    @CsvSource({"503,SERVICE_UNAVAILABLE", "503,UPSTREAM_UNAVAILABLE", "504,UPSTREAM_TIMEOUT"})
    void knownTransientStatusCodePairsKeepRetriesAndOptionalNull(int upstreamStatus, String code) throws Exception {
        structured(upstreamStatus, code);
        mockMvc.perform(get(PUBLIC + "/compose").header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.optional").value(org.hamcrest.Matchers.nullValue()));
        assertThat(DATA.hits(UPSTREAM)).isEqualTo(3);
    }

    @ParameterizedTest
    @ValueSource(strings = {"<html>temporary proxy failure</html>", "{}"})
    void publicPlainProxyServerErrorsKeepRetries(String body) throws Exception {
        DATA.on(UPSTREAM, request -> new MockUpstream.Response(502, body));
        mockMvc.perform(get(PUBLIC + "/sync").header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"));
        assertThat(DATA.hits(UPSTREAM)).isEqualTo(3);
    }

    private static void structured(int upstreamStatus, String code) {
        DATA.on(UPSTREAM, request -> new MockUpstream.Response(upstreamStatus,
                "{\"code\":\"" + code + "\",\"message\":\"synthetic\"}"));
    }

    @RestController
    static class ProbeController {
        private final DataApiClient data;
        private final ScreenComposer composer;

        ProbeController(DataApiClient data, ScreenComposer composer) {
            this.data = data;
            this.composer = composer;
        }

        @GetMapping({PUBLIC + "/sync", LEGACY + "/sync"})
        UserActivation synchronous(HttpServletRequest request) {
            return data.checkActivation(subject(request), Deadline.startingNow(Duration.ofSeconds(2)));
        }

        @GetMapping({PUBLIC + "/compose", LEGACY + "/compose"})
        Map<String, Object> composition(HttpServletRequest request) {
            UUID subject = subject(request);
            // 명시 생성자는 legacy 호환이어도 compose의 forReads에서 엄격한 계약으로 전환한다.
            UpstreamRequestContext context = composer.start(
                    (String) request.getAttribute(RequestEnvelopeFilter.REQUEST_ID), subject);
            return composer.compose(context, List.of(new ReadFragment<>("optional", false,
                    new ParameterizedTypeReference<UserActivation>() { },
                    Set.of(ReadFragment.TransientFailure.UNAVAILABLE, ReadFragment.TransientFailure.TIMEOUT),
                    reads -> data.checkActivation(subject, reads.deadline()))));
        }

        private UUID subject(HttpServletRequest request) {
            return UUID.fromString((String) request.getAttribute(AuthAttributes.USER_ID));
        }
    }
}
