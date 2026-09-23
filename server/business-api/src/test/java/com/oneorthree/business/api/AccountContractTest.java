package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.aMapWithSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 공개 계정 3종 {@code GET|PATCH|DELETE /me} (GROMO-1801) — 실제 등록 필터·서명 검증·MVC·HTTP client 를 쓰고
 * Data 만 계약 HTTP 서버로 대체한다. 오류는 계정 LLD §5 의 공개 이름·상태로 나가야 한다.
 */
class AccountContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000001801");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-0000-0000-0000-000000001801");
    private static final String KEY = "cccccccc-0000-4000-8000-000000001801";
    private static final String ROUTE = "/internal/users/" + USER;
    private static final String DATA_GET = "GET " + ROUTE;
    private static final String DATA_PATCH = "PATCH " + ROUTE;
    private static final String DATA_DELETE = "DELETE " + ROUTE;

    private static final String PREVIEW = "cache:business:preview:" + USER + ":";
    private static final String RATE = "cache:business:rate:" + USER;
    private static final String WITHDRAWN = "cache:business:withdrawn:" + USER;

    /** 탈퇴가 미리보기 사본을 실제로 지우는지 보려면 진짜 Redis 가 있어야 한다(GROMO-1943). */
    @SuppressWarnings("resource")
    private static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    @DynamicPropertySource
    static void redis(DynamicPropertyRegistry registry) {
        REDIS.start();
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
    }

    @Autowired
    StringRedisTemplate redis;

    @Test
    void readsAccountWithSignedSessionProofAndDataEnvelope() throws Exception {
        DATA.on(DATA_GET, request -> ok("{\"id\":\"" + USER + "\",\"name\":\"수빈\",\"catColor\":null,\"mainIslandId\":null,"
                + "\"linkedProviders\":[\"apple\",\"kakao\"],\"onboardingComplete\":true,"
                + "\"auth_generation\":3,\"deleted_at\":null,\"internal_note\":\"private\"}"));

        mockMvc.perform(auth(get("/me")).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data", aMapWithSize(6)))
                .andExpect(jsonPath("$.data.id").value(USER.toString()))
                .andExpect(jsonPath("$.data.name").value("수빈"))
                .andExpect(jsonPath("$.data.catColor").value(nullValue()))
                .andExpect(jsonPath("$.data.mainIslandId").value(nullValue()))
                .andExpect(jsonPath("$.data.linkedProviders[0]").value("apple"))
                .andExpect(jsonPath("$.data.linkedProviders[1]").value("kakao"))
                .andExpect(jsonPath("$.data.onboardingComplete").value(true));

        var sent = DATA.receivedFor(DATA_GET).get(0);
        assertThat(sent.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(sent.header("X-Session-Id")).isEqualTo(SESSION.toString());
        assertThat(sent.header("X-Auth-Generation")).isEqualTo("3");
    }

    @Test
    void renamesWithAppKeyAndReturnsFourFields() throws Exception {
        DATA.on(DATA_PATCH, request -> ok("{\"id\":\"" + USER + "\",\"name\":\"수빈\",\"catColor\":null,"
                + "\"mainIslandId\":null,\"auth_generation\":3,\"internal_note\":\"private\"}"));

        mockMvc.perform(write("{\"name\":\" 수빈 \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data", aMapWithSize(4)))
                .andExpect(jsonPath("$.data.id").value(USER.toString()))
                .andExpect(jsonPath("$.data.name").value("수빈"))
                .andExpect(jsonPath("$.data.catColor").value(nullValue()))
                .andExpect(jsonPath("$.data.mainIslandId").value(nullValue()))
                .andExpect(jsonPath("$.data.onboardingComplete").doesNotExist());

        var sent = DATA.receivedFor(DATA_PATCH).get(0);
        assertThat(sent.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(sent.header("X-Session-Id")).isEqualTo(SESSION.toString());
        assertThat(sent.body()).isEqualTo("{\"name\":\" 수빈 \"}");
    }

    @Test
    void accountBeforeOnboardingPreservesExplicitNullsAndEmptyProviders() throws Exception {
        DATA.on(DATA_GET, request -> ok("{\"id\":\"" + USER + "\",\"name\":null,\"catColor\":null,"
                + "\"mainIslandId\":null,\"linkedProviders\":[],\"onboardingComplete\":false}"));

        mockMvc.perform(auth(get("/me")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data", aMapWithSize(6)))
                .andExpect(jsonPath("$.data.id").value(USER.toString()))
                .andExpect(jsonPath("$.data.name").value(nullValue()))
                .andExpect(jsonPath("$.data.catColor").value(nullValue()))
                .andExpect(jsonPath("$.data.mainIslandId").value(nullValue()))
                .andExpect(jsonPath("$.data.linkedProviders").isEmpty())
                .andExpect(jsonPath("$.data.onboardingComplete").value(false));
    }

    @Test
    void patchesCatColorAloneOrWithName() throws Exception {
        DATA.on(DATA_PATCH, request -> ok("{\"id\":\"" + USER + "\",\"name\":\"수빈\",\"catColor\":\"calico\",\"mainIslandId\":null}"));

        mockMvc.perform(write("{\"catColor\":\"calico\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.catColor").value("calico"));
        mockMvc.perform(write("{\"name\":\"수빈\",\"catColor\":\"calico\"}")).andExpect(status().isOk());

        var sent = DATA.receivedFor(DATA_PATCH);
        assertThat(sent.get(0).body()).isEqualTo("{\"catColor\":\"calico\"}");
        assertThat(sent.get(1).body()).isEqualTo("{\"name\":\"수빈\",\"catColor\":\"calico\"}");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"name\":null}", "{\"name\":1}", "{\"catColor\":null}",
            "{\"catColor\":3}", "{\"name\":\"수빈\",\"extra\":true}", "{\"nickname\":\"수빈\"}",
            "{\"name\":1,\"catColor\":\"black\"}"})
    void rejectsMalformedPatchBeforeUpstream(String body) throws Exception {
        mockMvc.perform(write(body)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void patchesMainIslandAndRelaysNonMemberAsForbidden() throws Exception {
        UUID island = UUID.randomUUID();
        DATA.on(DATA_PATCH, request -> ok("{\"id\":\"" + USER + "\",\"name\":\"수빈\",\"catColor\":null,"
                + "\"mainIslandId\":\"" + island + "\"}"));

        mockMvc.perform(write("{\"mainIslandId\":\"" + island + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.mainIslandId").value(island.toString()));
        // 본문은 «온 필드만» 그대로 상류로 간다 — 옛 요청의 지문과 어긋나지 않게 한다.
        assertThat(DATA.receivedFor(DATA_PATCH).get(0).body())
                .isEqualTo("{\"mainIslandId\":\"" + island + "\"}");

        // 주민이 아닌 섬은 Data 가 403 MEMBER_ONLY 로 거절한다. 공개 코드로 옮기지 않으면 502 로 나간다.
        DATA.on(DATA_PATCH, request -> new MockUpstream.Response(403,
                "{\"code\":\"MEMBER_ONLY\",\"message\":\"그룹원만 조회할 수 있습니다.\"}"));
        mockMvc.perform(write("{\"mainIslandId\":\"" + UUID.randomUUID() + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.field").value("mainIslandId"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"mainIslandId\":null}", "{\"mainIslandId\":3}", "{\"mainIslandId\":\"\"}",
            "{\"mainIslandId\":\"not-a-uuid\"}",
            // UUID.fromString 이 «받아 주는» 축약 형식들. 걸러내지 않으면 패딩된 남의 섬 id 로 상류에 가서
            // 입력 형식 오류가 403 FORBIDDEN 으로 둔갑한다(GROMO-1765 에서 같은 결함이 잡혔다).
            "{\"mainIslandId\":\"1-2-3-4-5\"}",
            "{\"mainIslandId\":\"0-0-0-0-0\"}",
            "{\"mainIslandId\":\"aaaaaaa-1899-0000-0000-000000000013\"}"})
    void rejectsMalformedMainIslandBeforeUpstream(String body) throws Exception {
        mockMvc.perform(write(body)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.error.field").value("mainIslandId"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"catColor\":\"purple\"}", "{\"name\":\"수빈\",\"catColor\":\"Calico\"}",
            "{\"catColor\":\"\"}"})
    void catColorOutsideCatalogIsOutOfRange(String body) throws Exception {
        mockMvc.perform(write(body)).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("OUT_OF_RANGE"))
                .andExpect(jsonPath("$.error.field").value("catColor"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void withdrawsWithExactConfirmation() throws Exception {
        DATA.on(DATA_DELETE, request -> ok("{\"deleted\":true}"));
        String other = "cache:business:preview:" + UUID.randomUUID() + ":a";
        seedPreviewCopies(other);

        mockMvc.perform(withdraw("{\"confirmation\":\"DELETE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true));

        var sent = DATA.receivedFor(DATA_DELETE).get(0);
        assertThat(sent.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(sent.header("X-Session-Id")).isEqualTo(SESSION.toString());
        assertThat(sent.header("X-Auth-Generation")).isEqualTo("3");
        // 탈퇴가 확정되면 그 사용자의 미리보기·레이트 키가 지워지고 차단 표지가 남는다(GROMO-1943).
        assertThat(redis.keys(PREVIEW + "*")).isEmpty();
        assertThat(redis.hasKey(RATE)).isFalse();
        assertThat(redis.hasKey(WITHDRAWN)).isTrue();
        assertThat(redis.hasKey(other)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"confirmation\":\"delete\"}", "{\"confirmation\":\"DELETE \"}",
            "{\"confirmation\":null}", "{\"confirmation\":\"DELETE\",\"reason\":\"x\"}", "[]"})
    void rejectsWrongConfirmationBeforeUpstream(String body) throws Exception {
        mockMvc.perform(withdraw(body)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.error.field").value("confirmation"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void commandsRequireAppKey() throws Exception {
        mockMvc.perform(auth(patch("/me")).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"수빈\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        mockMvc.perform(auth(delete("/me")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"confirmation\":\"DELETE\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void sessionlessOrRefreshTokensNeverReachData() throws Exception {
        for (String token : List.of(Tokens.access(USER), Tokens.accessWithGeneration(USER, 3), Tokens.refresh(USER))) {
            mockMvc.perform(get("/me").header("Authorization", "Bearer " + token))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        }
        assertThat(DATA.received()).isEmpty();
    }

    /** 계정 LLD §5 — Data 판정은 이름·상태가 정확히 맞을 때만 공개 코드로 옮긴다. */
    @ParameterizedTest
    @CsvSource(nullValues = "-", value = {
            "PATCH,403,SESSION_NOT_ACTIVE,401,UNAUTHORIZED,-",
            "GET,404,USER_NOT_FOUND,404,USER_NOT_FOUND,-",
            "PATCH,400,NICKNAME_INVALID,400,NICKNAME_INVALID,name",
            "PATCH,409,NICKNAME_DUPLICATE,409,NICKNAME_DUPLICATE,name",
            "PATCH,409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "PATCH,503,PROFILE_UPDATE_UNAVAILABLE,503,SERVICE_UNAVAILABLE,-",
            "DELETE,400,HOST_WITHDRAW,400,HOST_WITHDRAW,-",
            "DELETE,404,USER_NOT_FOUND,404,USER_NOT_FOUND,-",
            "DELETE,403,SESSION_NOT_ACTIVE,401,UNAUTHORIZED,-",
            "DELETE,409,HOST_WITHDRAW,502,UPSTREAM_CONTRACT_ERROR,-"})
    void mapsDataVerdictsToPublicErrors(String method, int upstream, String code, int expected, String publicCode,
                                        String field) throws Exception {
        seedPreviewCopies();
        DATA.on(method + " " + ROUTE, request -> new MockUpstream.Response(upstream,
                "{\"code\":\"" + code + "\",\"message\":\"internal detail\"}"));
        MockHttpServletRequestBuilder request = switch (method) {
            case "GET" -> auth(get("/me"));
            case "PATCH" -> write("{\"name\":\"수빈\"}");
            default -> withdraw("{\"confirmation\":\"DELETE\"}");
        };
        mockMvc.perform(request).andExpect(status().is(expected))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(field == null ? jsonPath("$.error.field").value(nullValue())
                        : jsonPath("$.error.field").value(field))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
        // 확정되지 않은 탈퇴(거절·이미 탈퇴·세션 폐기)는 사본을 건드리지 않는다.
        assertCopiesUntouched();
    }

    @Test
    void foreignSubjectOrMissingFieldsAreContractErrors() throws Exception {
        DATA.on(DATA_GET, request -> ok("{\"id\":\"" + UUID.randomUUID() + "\",\"name\":null,\"catColor\":null,\"mainIslandId\":null,"
                + "\"linkedProviders\":[],\"onboardingComplete\":false}"));
        mockMvc.perform(auth(get("/me"))).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        DATA.on(DATA_GET, request -> ok("{\"id\":\"" + USER + "\",\"name\":null,\"catColor\":null}"));
        mockMvc.perform(auth(get("/me"))).andExpect(status().isBadGateway());
        DATA.on(DATA_DELETE, request -> ok("{\"deleted\":false}"));
        seedPreviewCopies();
        mockMvc.perform(withdraw("{\"confirmation\":\"DELETE\"}")).andExpect(status().isBadGateway());
        assertCopiesUntouched();
    }

    private void seedPreviewCopies(String... others) {
        redis.delete(List.of(WITHDRAWN, RATE, PREVIEW + "a", PREVIEW + "b"));
        redis.opsForValue().set(PREVIEW + "a", "{}");
        redis.opsForValue().set(PREVIEW + "b", "{}");
        redis.opsForValue().set(RATE, "3");
        for (String key : others) {
            redis.opsForValue().set(key, "{}");
        }
    }

    private void assertCopiesUntouched() {
        assertThat(redis.keys(PREVIEW + "*")).hasSize(2);
        assertThat(redis.hasKey(RATE)).isTrue();
        assertThat(redis.hasKey(WITHDRAWN)).isFalse();
    }

    private static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockHttpServletRequestBuilder write(String body) {
        return auth(patch("/me")).header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    private static MockHttpServletRequestBuilder withdraw(String body) {
        return auth(delete("/me")).header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }
}
