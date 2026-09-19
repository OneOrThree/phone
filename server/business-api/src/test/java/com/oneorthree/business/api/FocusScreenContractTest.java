package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/focus} 계약 (GROMO-1897) — 현재 세션 → (세션 섬 | 현재 섬) 상세 → 집중 주민.
 * 세션이 있으면 현재 섬이 아니라 세션이 고정한 섬을 연다.
 */
class FocusScreenContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1897-0000-0000-000000000002");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1897-0000-0000-000000000002");
    private static final UUID FOCUS = UUID.fromString("dddddddd-1897-0000-0000-000000000002");
    private static final UUID CURRENT = UUID.fromString("cccccccc-1897-0000-0000-000000000002");
    private static final UUID SESSION_ISLAND = UUID.fromString("cccccccc-1897-0000-0000-000000000003");

    private static final String DATA_CURRENT = "GET /internal/users/" + USER + "/focus-sessions/current";
    private static final String DATA_MINE = "GET /internal/users/" + USER + "/islands";

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void islands() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + CURRENT + "\"}"));
        for (UUID island : new UUID[] {CURRENT, SESSION_ISLAND}) {
            DATA.on(island(island), request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":"
                    + detail(island) + "}"));
            DATA.on(members(island), request -> ok(focusMembers(island)));
        }
    }

    @Test
    @DisplayName("세션이 있으면 세션 섬을 열고 현재 섬 목록은 부르지 않는다 — playback 은 null + missingFragments")
    void sessionPinsTheIsland() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":" + session(SESSION_ISLAND) + "}"));

        String body = mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(SESSION_ISLAND.toString()))
                .andExpect(jsonPath("$.data.session.id").value(FOCUS.toString()))
                .andExpect(jsonPath("$.data.session.version").value(1))
                .andExpect(jsonPath("$.data.focusMembers.items[0].userId").value(USER.toString()))
                .andExpect(jsonPath("$.data.focusMembers.watermarks[0].projection").value("focus.member"))
                .andExpect(jsonPath("$.data.focusMembers.watermarks[0].islandId").value(SESSION_ISLAND.toString()))
                .andExpect(jsonPath("$.data.missingFragments.length()").value(1))
                .andExpect(jsonPath("$.data.missingFragments[0]").value("playback"))
                .andReturn().getResponse().getContentAsString();

        JsonNode data = JSON.readTree(body).get("data");
        assertThat(data.get("playback").isNull()).isTrue();
        assertThat(data.get("playbackAvailability").isNull())
                .as("시설 완공을 검증할 재료가 없다 — facility_locked 로 위장하지 않는다").isTrue();
        assertThat(DATA.hits(DATA_MINE)).isZero();
        assertThat(DATA.hits(members(CURRENT))).isZero();
    }

    @Test
    @DisplayName("세션이 없으면 session:null 정상값이고 현재 섬을 연다")
    void noSessionUsesCurrentIsland() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));

        String body = mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.island.id").value(CURRENT.toString()))
                .andExpect(jsonPath("$.data.focusMembers.watermarks[0].islandId").value(CURRENT.toString()))
                .andReturn().getResponse().getContentAsString();

        JsonNode data = JSON.readTree(body).get("data");
        assertThat(data.has("session") && data.get("session").isNull()).isTrue();
        assertThat(DATA.hits(members(SESSION_ISLAND))).isZero();
    }

    @Test
    @DisplayName("집중 주민의 도메인 403 은 화면 전체 403 이다")
    void focusMembersForbiddenFailsWholeScreen() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        DATA.on(members(CURRENT), request -> new MockUpstream.Response(403,
                "{\"code\":\"MEMBER_ONLY\",\"message\":\"private detail\"}"));

        mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.field").value("islandId"));
    }

    @Test
    @DisplayName("필수 조각이 시간 초과면 빈 조각 200 이 아니라 화면 전체 504 다")
    void fragmentTimeoutIs504() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        // ci 의 read-timeout 은 300ms 다 — 매 시도를 그보다 길게 붙든다. 3초 화면 예산 자체의 소진은
        // HttpExecutionIntegrationTest 가 전용 조합기로 본다(여기서 3초를 붙들면 공유 mock 이 막힌다).
        DATA.on(members(CURRENT), request -> {
            pause(350);
            return ok(focusMembers(CURRENT));
        });

        mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isGatewayTimeout())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_TIMEOUT"));
        // mock 상류는 스레드 하나다 — 붙든 시도가 끝날 때까지 기다려 다음 테스트 요청이 줄 서지 않게 한다.
        pause(400);
    }

    private static void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Test
    @DisplayName("query 는 받지 않는다 — 400, 상류 호출 없음")
    void rejectsAnyQuery() throws Exception {
        mockMvc.perform(auth(get("/screens/focus")).queryParam("islandId", CURRENT.toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        assertThat(DATA.received()).isEmpty();
    }

    private static String island(UUID island) {
        return "GET /internal/islands/" + island;
    }

    private static String members(UUID island) {
        return "GET /internal/islands/" + island + "/focus-members";
    }

    private static String detail(UUID island) {
        return "{\"id\":\"" + island + "\",\"name\":\"모래섬\",\"intro\":\"\",\"visibility\":\"public\","
                + "\"approvalRequired\":false,\"memberCount\":2,\"membershipStatus\":\"active\","
                + "\"growthStage\":null,\"themeId\":null,\"role\":\"member\",\"version\":3}";
    }

    private static String session(UUID island) {
        return "{\"id\":\"" + FOCUS + "\",\"islandId\":\"" + island + "\",\"subject\":\"알고리즘\","
                + "\"targetMinutes\":60,\"status\":\"active\",\"activeSeconds\":0,"
                + "\"serverNow\":\"2026-09-17T00:00:00Z\",\"startedAt\":\"2026-09-17T00:00:00Z\","
                + "\"restStartedAt\":null,\"version\":1}";
    }

    private static String focusMembers(UUID island) {
        return "{\"items\":[{\"userId\":\"" + USER + "\",\"name\":\"수빈\",\"sessionId\":\"" + FOCUS + "\","
                + "\"subject\":\"알고리즘\",\"activeSeconds\":0,\"status\":\"active\"}],"
                + "\"serverNow\":\"2026-09-17T00:00:00Z\",\"watermarks\":[{\"projection\":\"focus.member\","
                + "\"islandId\":\"" + island + "\",\"aggregateId\":\"" + USER + "\",\"version\":1}]}";
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }
}
