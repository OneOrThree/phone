package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 Servlet 필터·서명·컨트롤러·TCP 클라이언트. 상류의 원자 변경은 Data 통합 테스트가 검증한다. */
class IslandHostTransferContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID TARGET = UUID.fromString("dddddddd-0000-0000-0000-000000000001");
    private static final String KEY = "eeeeeeee-0000-5000-8000-000000000001";
    private static final String PATH = "/islands/" + ISLAND + "/host-transfer";
    private static final String DATA_PATH = "POST /internal" + PATH;
    private static final String BODY = "{\"targetUserId\":\"" + TARGET + "\"}";
    private static final String RESULT = "{\"hostUserId\":\"" + TARGET + "\",\"version\":7}";

    @Test
    void forwardsOnlySignedActorAndExactCommandAndProjectsResponseExtensions() throws Exception {
        DATA.on(DATA_PATH, request -> ok(RESULT.replace("}", ",\"futureField\":true}")));
        mockMvc.perform(write(BODY).header("X-User-Id", UUID.randomUUID())
                        .header("X-Service-Token", "attacker").header("X-Request-Id", "attacker"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.hostUserId").value(TARGET.toString()))
                .andExpect(jsonPath("$.data.version").value(7))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.hostUserId").doesNotExist());
        assertThat(DATA.received()).hasSize(1);
        var sent = DATA.received().get(0);
        assertThat(sent.header("Authorization")).isEqualTo("Bearer ci-token-data");
        assertThat(sent.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(sent.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(sent.header("X-Service-Token")).isNull();
        assertThat(sent.header("X-Request-Id")).isNotBlank().isNotEqualTo("attacker");
        assertThat(sent.body()).contains(SESSION.toString(), TARGET.toString(), "\"authGeneration\":3")
                .doesNotContain("attacker", "expectedVersion", "accessToken");
        assertThat(NOTI.received()).isEmpty();
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    void disabledProviderRemainsRetryable503WithoutDownstreamDeliveryOrPretendSuccess() throws Exception {
        DATA.on(DATA_PATH, request -> error(503, "REALTIME_NOT_READY"));
        mockMvc.perform(write(BODY)).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.error.retryable").value(true))
                .andExpect(jsonPath("$.error.length()").value(4))
                .andExpect(jsonPath("$.requestId").isNotEmpty()).andExpect(jsonPath("$.data").doesNotExist());
        assertThat(DATA.received()).hasSize(1);
        assertThat(NOTI.received()).isEmpty();
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    void responseLossRetriesSameDurableCommandAndReturnsOriginalVersion() throws Exception {
        AtomicBoolean first = new AtomicBoolean(true);
        DATA.on(DATA_PATH, request -> first.getAndSet(false) ? MockUpstream.Response.disconnected() : ok(RESULT));
        mockMvc.perform(write(BODY)).andExpect(status().isOk()).andExpect(jsonPath("$.data.version").value(7));
        assertThat(DATA.hits(DATA_PATH)).isEqualTo(2);
        assertThat(DATA.received()).allSatisfy(request -> {
            assertThat(request.header("Idempotency-Key")).isEqualTo(KEY);
            assertThat(request.body()).isEqualTo(DATA.received().get(0).body());
        });
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"targetUserId\":null}", "{\"targetUserId\":3}",
            "{\"targetUserId\":true}", "{\"targetUserId\":[]}",
            "{\"targetUserId\":\"dddddddd-0000-0000-0000-000000000001\",\"expectedVersion\":1}"})
    void rejectsBodyShapeBeforeNetwork(String body) throws Exception {
        mockMvc.perform(write(body)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "1-2-3-4-5", " dddddddd-0000-0000-0000-000000000001",
            "dddddddd-0000-0000-0000-000000000001 ", "dddddddd-0000-0000-0000-00000000000g"})
    void rejectsMalformedTargetIds(String value) throws Exception {
        mockMvc.perform(write("{\"targetUserId\":\"" + value + "\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.field").value("targetUserId"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void requiresOneUuidKeyAndSignedSessionWithoutLegacyFallback() throws Exception {
        for (String key : List.of("", "bad", KEY + " ", "1-2-3-4-5")) {
            mockMvc.perform(auth(post(PATH)).contentType(MediaType.APPLICATION_JSON).content(BODY)
                            .header("Idempotency-Key", key)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        }
        mockMvc.perform(auth(post(PATH)).contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isBadRequest());
        mockMvc.perform(write(BODY).header("Idempotency-Key", KEY)).andExpect(status().isBadRequest());
        for (String token : List.of(Tokens.access(USER), Tokens.accessWithGeneration(USER, 3),
                Tokens.expired(USER), Tokens.refreshWithSession(USER, 3, SESSION), Tokens.signedWithOtherKey(USER))) {
            mockMvc.perform(post(PATH).header("Authorization", "Bearer " + token)
                            .header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(BODY))
                    .andExpect(status().isUnauthorized());
        }
        mockMvc.perform(post(PATH).header("X-User-Id", USER).contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"409,CANNOT_TRANSFER_SELF,409,STATE_CONFLICT,targetUserId",
            "403,NOT_OWNER,403,FORBIDDEN,", "403,SESSION_NOT_ACTIVE,401,UNAUTHORIZED,",
            "404,TARGET_USER_NOT_FOUND,404,NOT_FOUND,targetUserId", "404,NOT_FOUND,404,NOT_FOUND,targetUserId",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId", "404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "401,SESSION_NOT_ACTIVE,502,UPSTREAM_AUTH_FAILED,",
            "401,INVALID_SERVICE_TOKEN,502,UPSTREAM_AUTH_FAILED,",
            "403,INVALID_SERVICE_TOKEN,502,UPSTREAM_CONTRACT_ERROR,",
            "409,NOT_OWNER,502,UPSTREAM_CONTRACT_ERROR,",
            "409,REALTIME_NOT_READY,502,UPSTREAM_CONTRACT_ERROR,",
            "503,UNKNOWN_ERROR,502,UPSTREAM_CONTRACT_ERROR,"})
    void mapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on(DATA_PATH, request -> error(upstreamStatus, code));
        var result = mockMvc.perform(write(BODY)).andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field))
                .andExpect(jsonPath("$.requestId").isNotEmpty()).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private detail");
        assertThat(DATA.hits(DATA_PATH)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "{}", "[]", "{\"hostUserId\":null,\"version\":1}",
            "{\"hostUserId\":\"1-2-3-4-5\",\"version\":1}",
            "{\"hostUserId\":\"aaaaaaaa-0000-0000-0000-000000000001\",\"version\":1}"})
    void rejectsInvalidOrDifferentHostResult(String response) throws Exception {
        DATA.on(DATA_PATH, request -> ok(response));
        mockMvc.perform(write(BODY)).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        assertThat(DATA.hits(DATA_PATH)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "\"1\"", "true", "0", "-1", "1.5", "1.0", "9007199254740992",
            "9999999999999999999999999999"})
    void rejectsNonPositiveOrCoercedOrUnsafeVersion(String version) throws Exception {
        DATA.on(DATA_PATH, request -> ok("{\"hostUserId\":\"" + TARGET + "\",\"version\":" + version + "}"));
        mockMvc.perform(write(BODY)).andExpect(status().isBadGateway());
        assertThat(DATA.hits(DATA_PATH)).isEqualTo(1);
    }

    @Test
    void permitsUuidCaseAndSafeVersionBoundaryButNotMissingVersion() throws Exception {
        DATA.on(DATA_PATH, request -> ok("{\"hostUserId\":\"" + TARGET.toString().toUpperCase(java.util.Locale.ROOT)
                + "\",\"version\":9007199254740991}"));
        mockMvc.perform(write(BODY)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.hostUserId").value(TARGET.toString()))
                .andExpect(jsonPath("$.data.version").value(9007199254740991L));
        DATA.on(DATA_PATH, request -> ok("{\"hostUserId\":\"" + TARGET + "\"}"));
        mockMvc.perform(write(BODY)).andExpect(status().isBadGateway());
    }

    @Test
    void preservesMethodAndPathBoundary() throws Exception {
        mockMvc.perform(auth(get(PATH))).andExpect(status().isMethodNotAllowed());
        mockMvc.perform(auth(post("/islands/1-2-3-4-5/host-transfer"))
                        .header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.field").value("islandId"));
        mockMvc.perform(write(BODY).queryParam("expectedVersion", "1")).andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private MockHttpServletRequestBuilder write(String body) {
        return auth(post(PATH)).header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
