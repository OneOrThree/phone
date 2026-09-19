package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 같이 낚시 초기 스냅샷 2종의 계약 (GROMO-1765) — 실제 필터·컨트롤러·TCP 클라이언트로 검증한다.
 * 목록·watermark 의 정합은 data-api 통합 테스트가 본다. 여기서는 경계를 본다: 주체, 봉투, 오류 표.
 */
class IslandFocusMembersContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1765-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1765-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1765-0000-0000-000000000001");
    private static final UUID OTHER = UUID.fromString("dddddddd-1765-0000-0000-000000000001");

    private static final String INTERNAL = "/internal/islands/" + ISLAND;
    private static final String DATA_FOCUS = "GET " + INTERNAL + "/focus-members";
    private static final String DATA_REST = "GET " + INTERNAL + "/rest-members";

    private static final String FOCUS_BODY = "{\"items\":[{\"userId\":\"" + OTHER + "\",\"name\":null,"
            + "\"sessionId\":\"" + SESSION + "\",\"subject\":\"영어 단어\",\"activeSeconds\":1320,"
            + "\"status\":\"active\"}],\"serverNow\":\"2026-09-11T09:10:00Z\","
            + "\"watermarks\":[{\"projection\":\"focus.member\",\"islandId\":\"" + ISLAND + "\","
            + "\"aggregateId\":\"" + OTHER + "\",\"version\":5}]}";
    private static final String REST_BODY = "{\"items\":[{\"userId\":\"" + OTHER + "\",\"name\":\"수아\","
            + "\"restSeat\":1,\"restStartedAt\":\"2026-09-11T09:07:00Z\"}],"
            + "\"serverNow\":\"2026-09-11T09:10:00Z\","
            + "\"watermarks\":[{\"projection\":\"rest.member\",\"islandId\":\"" + ISLAND + "\","
            + "\"aggregateId\":\"" + OTHER + "\",\"version\":2}]}";

    @Test
    @DisplayName("focus-members 는 상류 스냅샷을 data 봉투로 내리고 watermark·null 이름 키를 보존한다")
    void focusMembersPassesThroughInEnvelope() throws Exception {
        DATA.on(DATA_FOCUS, request -> ok(FOCUS_BODY));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/focus-members"))
                        .header("X-User-Id", OTHER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].userId").value(OTHER.toString()))
                .andExpect(jsonPath("$.data.items[0].name").value((Object) null))
                .andExpect(jsonPath("$.data.items[0].sessionId").value(SESSION.toString()))
                .andExpect(jsonPath("$.data.items[0].activeSeconds").value(1320))
                .andExpect(jsonPath("$.data.items[0].status").value("active"))
                .andExpect(jsonPath("$.data.serverNow").value("2026-09-11T09:10:00Z"))
                .andExpect(jsonPath("$.data.watermarks[0].projection").value("focus.member"))
                .andExpect(jsonPath("$.data.watermarks[0].aggregateId").value(OTHER.toString()))
                .andExpect(jsonPath("$.data.watermarks[0].version").value(5));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_FOCUS).get(0);
        assertThat(forwarded.header("X-User-Id")).as("주체는 서명된 세션에서만 온다").isEqualTo(USER.toString());
        assertThat(forwarded.query()).isNull();
    }

    @Test
    @DisplayName("rest-members 는 restSeat·restStartedAt 과 rest.member watermark 를 내린다")
    void restMembersPassesThroughInEnvelope() throws Exception {
        DATA.on(DATA_REST, request -> ok(REST_BODY));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/rest-members")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].name").value("수아"))
                .andExpect(jsonPath("$.data.items[0].restSeat").value(1))
                .andExpect(jsonPath("$.data.items[0].restStartedAt").value("2026-09-11T09:07:00Z"))
                .andExpect(jsonPath("$.data.items[0].sessionId").doesNotExist())
                .andExpect(jsonPath("$.data.watermarks[0].projection").value("rest.member"))
                .andExpect(jsonPath("$.data.watermarks[0].version").value(2));
    }

    @ParameterizedTest
    @CsvSource({"focus-members,403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "rest-members,403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "focus-members,404,USER_NOT_FOUND,404,USER_NOT_FOUND,",
            "rest-members,409,MEMBER_ONLY,502,UPSTREAM_CONTRACT_ERROR,",
            "focus-members,400,UNKNOWN_ERROR,502,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 502 다")
    void mapsOnlyExactDomainStatusAndCode(String route, int upstreamStatus, String code, int publicStatus,
            String publicCode, String field) throws Exception {
        DATA.on("GET " + INTERNAL + "/" + route, request -> new MockUpstream.Response(upstreamStatus,
                "{\"code\":\"" + code + "\",\"message\":\"private detail\"}"));

        String body = mockMvc.perform(auth(get("/islands/" + ISLAND + "/" + route)))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("private detail");
    }

    @Test
    @DisplayName("서명 세션이 없거나 islandId 가 UUID 가 아니면 상류를 부르지 않는다")
    void rejectsBeforeTheNetwork() throws Exception {
        mockMvc.perform(get("/islands/" + ISLAND + "/focus-members").header("X-User-Id", USER))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(auth(get("/islands/not-a-uuid/rest-members")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("islandId"));
        assertThat(DATA.received()).isEmpty();
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }
}
