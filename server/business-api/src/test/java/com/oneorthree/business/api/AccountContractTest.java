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

import static org.assertj.core.api.Assertions.assertThat;
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

    @Test
    void readsAccountWithSignedSessionProofAndDataEnvelope() throws Exception {
        DATA.on(DATA_GET, request -> ok("{\"id\":\"" + USER + "\",\"name\":\"수빈\",\"catColor\":null,"
                + "\"linkedProviders\":[\"apple\",\"kakao\"],\"onboardingComplete\":true}"));

        mockMvc.perform(auth(get("/me")).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(USER.toString()))
                .andExpect(jsonPath("$.data.name").value("수빈"))
                .andExpect(jsonPath("$.data.catColor").value(nullValue()))
                .andExpect(jsonPath("$.data.linkedProviders[0]").value("apple"))
                .andExpect(jsonPath("$.data.linkedProviders[1]").value("kakao"))
                .andExpect(jsonPath("$.data.onboardingComplete").value(true));

        var sent = DATA.receivedFor(DATA_GET).get(0);
        assertThat(sent.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(sent.header("X-Session-Id")).isEqualTo(SESSION.toString());
        assertThat(sent.header("X-Auth-Generation")).isEqualTo("3");
    }

    @Test
    void renamesWithAppKeyAndReturnsThreeFields() throws Exception {
        DATA.on(DATA_PATCH, request -> ok("{\"id\":\"" + USER + "\",\"name\":\"수빈\",\"catColor\":null}"));

        mockMvc.perform(write("{\"name\":\" 수빈 \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(USER.toString()))
                .andExpect(jsonPath("$.data.name").value("수빈"))
                .andExpect(jsonPath("$.data.catColor").value(nullValue()))
                .andExpect(jsonPath("$.data.onboardingComplete").doesNotExist());

        var sent = DATA.receivedFor(DATA_PATCH).get(0);
        assertThat(sent.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(sent.header("X-Session-Id")).isEqualTo(SESSION.toString());
        assertThat(sent.body()).isEqualTo("{\"name\":\" 수빈 \"}");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"name\":null}", "{\"name\":1}", "{\"catColor\":null}",
            "{\"catColor\":3}", "{\"name\":\"수빈\",\"extra\":true}", "{\"nickname\":\"수빈\"}"})
    void rejectsMalformedPatchBeforeUpstream(String body) throws Exception {
        mockMvc.perform(write(body)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"catColor\":\"black\"}", "{\"name\":\"수빈\",\"catColor\":\"calico\"}"})
    void catColorHasNoApprovedCatalogYet(String body) throws Exception {
        mockMvc.perform(write(body)).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("OUT_OF_RANGE"))
                .andExpect(jsonPath("$.error.field").value("catColor"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void withdrawsWithExactConfirmation() throws Exception {
        DATA.on(DATA_DELETE, request -> ok("{\"deleted\":true}"));

        mockMvc.perform(withdraw("{\"confirmation\":\"DELETE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true));

        var sent = DATA.receivedFor(DATA_DELETE).get(0);
        assertThat(sent.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(sent.header("X-Session-Id")).isEqualTo(SESSION.toString());
        assertThat(sent.header("X-Auth-Generation")).isEqualTo("3");
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
            "DELETE,400,HOST_WITHDRAW,400,HOST_WITHDRAW,-",
            "DELETE,404,USER_NOT_FOUND,404,USER_NOT_FOUND,-",
            "DELETE,403,SESSION_NOT_ACTIVE,401,UNAUTHORIZED,-",
            "DELETE,409,HOST_WITHDRAW,502,UPSTREAM_CONTRACT_ERROR,-"})
    void mapsDataVerdictsToPublicErrors(String method, int upstream, String code, int expected, String publicCode,
                                        String field) throws Exception {
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
    }

    @Test
    void foreignSubjectOrMissingFieldsAreContractErrors() throws Exception {
        DATA.on(DATA_GET, request -> ok("{\"id\":\"" + UUID.randomUUID() + "\",\"name\":null,\"catColor\":null,"
                + "\"linkedProviders\":[],\"onboardingComplete\":false}"));
        mockMvc.perform(auth(get("/me"))).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        DATA.on(DATA_GET, request -> ok("{\"id\":\"" + USER + "\",\"name\":null,\"catColor\":null}"));
        mockMvc.perform(auth(get("/me"))).andExpect(status().isBadGateway());
        DATA.on(DATA_DELETE, request -> ok("{\"deleted\":false}"));
        mockMvc.perform(withdraw("{\"confirmation\":\"DELETE\"}")).andExpect(status().isBadGateway());
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
