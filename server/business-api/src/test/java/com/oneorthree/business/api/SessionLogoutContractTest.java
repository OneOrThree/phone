package com.oneorthree.business.api;

import com.oneorthree.business.auth.LogoutCredentials;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 서명, Servlet 필터 체인, HTTP 상류를 거치는 로그아웃 계약 검증. */
class SessionLogoutContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
    private static final String PATH = "/auth/sessions/current";
    private static final String INTERNAL = "POST /internal/auth/sessions/logout";
    private static final String RT = Tokens.refreshWithSession(USER, 3, SESSION);
    private static final String AT = Tokens.accessWithSession(USER, 3, SESSION);
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void refreshTokenAloneRevokesOnlyItsSessionWithoutDelegatedUserHeader() throws Exception {
        DATA.on(INTERNAL, request -> ok("{\"revoked\":true,\"futureField\":123}"));
        var result = mockMvc.perform(logout().header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.revoked").value(true))
                .andExpect(jsonPath("$.data.futureField").doesNotExist())
                .andExpect(jsonPath("$.revoked").doesNotExist()).andReturn();
        assertThat(DATA.hits(INTERNAL)).isEqualTo(1);
        var sent = DATA.receivedFor(INTERNAL).get(0);
        assertThat(mapper.readTree(sent.body()).get("refreshToken").textValue()).isEqualTo(RT);
        assertThat(mapper.readTree(sent.body()).get("accessToken").isNull()).isTrue();
        assertThat(sent.header("X-User-Id")).isNull();
        assertThat(sent.header("X-Refresh-Token")).isNull();
        assertThat(sent.header("Authorization")).startsWith("Bearer ").doesNotContain(RT);
        assertThat(sent.header("X-Request-Id")).isEqualTo(result.getResponse().getHeader("X-Request-Id"));
        assertThat(NOTI.received()).isEmpty();
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    void forwardsValidatedOptionalAccessTokenAsRawCredentialWithoutDelegatingItsSubject() throws Exception {
        DATA.on(INTERNAL, request -> ok("{\"revoked\":true}"));
        mockMvc.perform(logout().header("Authorization", "Bearer " + AT)).andExpect(status().isOk());
        var sent = DATA.receivedFor(INTERNAL).get(0);
        assertThat(mapper.readTree(sent.body()).get("accessToken").textValue()).isEqualTo(AT);
        assertThat(sent.header("X-User-Id")).isNull();
        assertThat(new LogoutCredentials(RT, AT).toString()).doesNotContain(RT, AT);
    }

    @Test
    void rejectsMissingDuplicateEmptyAndOversizedRefreshHeadersBeforeData() throws Exception {
        mockMvc.perform(delete(PATH)).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("REFRESH_TOKEN"));
        for (String value : List.of("", " ", "token,token", " token", "x".repeat(8193))) {
            mockMvc.perform(delete(PATH).header("X-Refresh-Token", value))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("REFRESH_TOKEN"));
        }
        mockMvc.perform(delete(PATH).header("X-Refresh-Token", RT, RT))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("REFRESH_TOKEN"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void optionalMeansAbsentAndDoesNotPermitInvalidProvidedAccessToken() throws Exception {
        for (String token : List.of(Tokens.expired(USER), Tokens.signedWithOtherKey(USER),
                Tokens.refresh(USER), Tokens.withoutExpiration(USER), "invalid")) {
            mockMvc.perform(logout().header("Authorization", "Bearer " + token))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        }
        for (String header : List.of("", "Bearer ", "Basic " + AT, "x".repeat(8193))) {
            mockMvc.perform(logout().header("Authorization", header))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        }
        mockMvc.perform(logout().header("Authorization", "Bearer " + AT, "Bearer " + AT))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", " ", "{\"refreshToken\":\"other\"}"})
    void publicRequestHasNoBody(String body) throws Exception {
        mockMvc.perform(logout().contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void doesNotAcceptCredentialInQueryString() throws Exception {
        mockMvc.perform(delete(PATH + "?refreshToken=not-a-credential").header("X-Refresh-Token", RT))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"GET", "POST", "PATCH", "PUT", "OPTIONS"})
    void otherMethodsStillRequireAccessToken(String method) throws Exception {
        mockMvc.perform(request(HttpMethod.valueOf(method), PATH).header("X-Refresh-Token", RT))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/auth/sessions/current/", "/auth;v=1/sessions/current",
            "/%61uth/sessions/current", "/auth/sessions/cur%72ent", "/auth/sessions/other", "/auth/login"})
    void normalizedAliasesCannotBypassRequiredAccessToken(String path) throws Exception {
        mockMvc.perform(delete(URI.create(path)).header("X-Refresh-Token", RT))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void authenticatedWrongMethodGetsMethodErrorRatherThanPerformingLogout() throws Exception {
        mockMvc.perform(request(HttpMethod.POST, PATH).header("Authorization", "Bearer " + AT)
                        .header("X-Refresh-Token", RT))
                .andExpect(status().isMethodNotAllowed());
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"401,REFRESH_TOKEN,401,REFRESH_TOKEN", "401,UNAUTHORIZED,401,UNAUTHORIZED",
            "404,USER_NOT_FOUND,404,USER_NOT_FOUND", "401,INVALID_SERVICE_TOKEN,502,UPSTREAM_AUTH_FAILED",
            "401,SOMETHING_NEW,502,UPSTREAM_AUTH_FAILED", "403,UNAUTHORIZED,502,UPSTREAM_CONTRACT_ERROR"})
    void separatesDataCredentialErrorsFromServiceAuthorizationErrors(int upstreamStatus, String upstreamCode,
            int publicStatus, String publicCode) throws Exception {
        DATA.on(INTERNAL, request -> new MockUpstream.Response(upstreamStatus,
                "{\"code\":\"" + upstreamCode + "\",\"message\":\"credential rejected\"}"));
        mockMvc.perform(logout()).andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.retryable").value(false))
                .andExpect(jsonPath("$.requestId").isString());
        assertThat(DATA.hits(INTERNAL)).isEqualTo(1);
    }

    @Test
    void unstructuredService403KeepsExistingCredentialFailure() throws Exception {
        DATA.on(INTERNAL, request -> new MockUpstream.Response(403, "{}"));
        mockMvc.perform(logout()).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_AUTH_FAILED"));
        assertThat(DATA.hits(INTERNAL)).isEqualTo(1);
    }

    @Test
    void signedButDifferentSessionAccessTokenIsRejectedByDataWithoutHidingFailure() throws Exception {
        String otherSession = Tokens.accessWithSession(USER, 3, UUID.randomUUID());
        DATA.on(INTERNAL, request -> new MockUpstream.Response(401,
                "{\"code\":\"UNAUTHORIZED\",\"message\":\"session mismatch\"}"));
        mockMvc.perform(logout().header("Authorization", "Bearer " + otherSession))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        assertThat(mapper.readTree(DATA.received().get(0).body()).get("accessToken").textValue())
                .isEqualTo(otherSession);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "not json"})
    void unstructuredService401NeverBecomesRefreshTokenFailure(String body) throws Exception {
        DATA.on(INTERNAL, request -> new MockUpstream.Response(401, body));
        mockMvc.perform(logout()).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_AUTH_FAILED"));
        assertThat(DATA.hits(INTERNAL)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{}", "[]", "{\"revoked\":false}", "{\"revoked\":null}",
            "{\"revoked\":\"true\"}", "{\"revoked\":1}", "{\"data\":{\"revoked\":true}}"})
    void successRequiresExplicitBooleanTrue(String body) throws Exception {
        DATA.on(INTERNAL, request -> ok(body));
        mockMvc.perform(logout()).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        assertThat(DATA.hits(INTERNAL)).isEqualTo(1);
    }

    @Test
    void lostResponseRetriesIdenticalOriginalCredentialsAndReturnsDurableCompletion() throws Exception {
        AtomicBoolean first = new AtomicBoolean(true);
        DATA.on(INTERNAL, request -> first.getAndSet(false)
                ? MockUpstream.Response.disconnected() : ok("{\"revoked\":true}"));
        mockMvc.perform(logout().header("Authorization", "Bearer " + AT))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.revoked").value(true));
        var attempts = DATA.receivedFor(INTERNAL);
        assertThat(attempts).hasSize(2);
        assertThat(attempts.get(1).body()).isEqualTo(attempts.get(0).body());
        assertThat(attempts.get(1).header("X-Request-Id")).isEqualTo(attempts.get(0).header("X-Request-Id"));
        assertThat(attempts).allSatisfy(attempt -> assertThat(attempt.header("X-User-Id")).isNull());
        assertThat(NOTI.received()).isEmpty();
    }

    @Test
    void publicUnknownStructuredServerFailureIsTerminal() throws Exception {
        DATA.on(INTERNAL, request -> new MockUpstream.Response(503,
                "{\"code\":\"UNKNOWN_LOGOUT_ERROR\",\"message\":\"unknown\"}"));
        mockMvc.perform(logout()).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        assertThat(DATA.hits(INTERNAL)).isEqualTo(1);
    }

    private MockHttpServletRequestBuilder logout() {
        return delete(PATH).header("X-Refresh-Token", RT);
    }

    private MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }
}
