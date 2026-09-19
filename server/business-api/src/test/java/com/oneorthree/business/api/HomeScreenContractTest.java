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
 * {@code GET /screens/home} 계약 (GROMO-1897) — 섬 문맥(현재 섬 → 주민 상세) 뒤 집중 요약·현재 세션 병렬.
 * 실제 필터·컨트롤러·조합기·TCP 클라이언트로 보고 상류만 {@link MockUpstream} 으로 바꾼다.
 */
class HomeScreenContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1897-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1897-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1897-0000-0000-000000000001");

    private static final String DATA_MINE = "GET /internal/users/" + USER + "/islands";
    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_SUMMARY = "GET /internal/users/" + USER + "/focus-summary";
    private static final String DATA_CURRENT = "GET /internal/users/" + USER + "/focus-sessions/current";
    private static final String DATA_REST = "GET /internal/islands/" + ISLAND + "/rest-members";

    private static final String DETAIL = "{\"id\":\"" + ISLAND + "\",\"name\":\"모래섬\",\"intro\":\"\","
            + "\"visibility\":\"public\",\"approvalRequired\":false,\"memberCount\":1,"
            + "\"membershipStatus\":\"active\",\"growthStage\":null,\"themeId\":null,"
            + "\"role\":\"host\",\"version\":3}";
    private static final String SUMMARY = "{\"date\":\"2026-09-17\",\"completedSeconds\":60,"
            + "\"currentSessionSecondsToday\":30,\"totalSeconds\":90,\"serverNow\":\"2026-09-17T00:00:00Z\"}";

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void currentIsland() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + DETAIL + "}"));
        DATA.on(DATA_SUMMARY, request -> ok(SUMMARY));
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
    }

    @Test
    @DisplayName("정상: 조각 이름이 응답 키이고 도메인 DTO 를 그대로 싣는다 — 빠진 조각은 null + missingFragments")
    void composesFragmentsUnderTheirNames() throws Exception {
        String body = mockMvc.perform(auth(get("/screens/home")).queryParam("date", "2026-09-17")
                        .queryParam("timezone", "Asia/Seoul").header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.island.role").value("host"))
                .andExpect(jsonPath("$.data.island.version").value(3))
                .andExpect(jsonPath("$.data.focusSummary.totalSeconds").value(90))
                .andExpect(jsonPath("$.data.focusSummary.serverNow").value("2026-09-17T00:00:00Z"))
                .andExpect(jsonPath("$.data.missingFragments[0]").value("restMembers"))
                .andExpect(jsonPath("$.data.missingFragments[1]").value("wallets"))
                .andExpect(jsonPath("$.data.missingFragments[2]").value("playback"))
                .andExpect(jsonPath("$.data.asOf").doesNotExist())
                .andReturn().getResponse().getContentAsString();

        JsonNode data = JSON.readTree(body).get("data");
        for (String key : new String[] {"session", "restMembers", "wallets", "playback", "playbackAvailability"}) {
            assertThat(data.has(key)).as(key + " 키는 명시 null 로 있어야 한다").isTrue();
            assertThat(data.get(key).isNull()).as(key).isTrue();
        }
        assertThat(DATA.hits(DATA_REST)).as("BG11 미결 — 휴식 주민을 부르지 않는다").isZero();
        assertThat(DATA.receivedFor(DATA_SUMMARY).get(0).query()).contains("date=2026-09-17", "timezone=Asia/Seoul");
        assertThat(DATA.received()).allSatisfy(forwarded ->
                assertThat(forwarded.header("x-user-id")).as("주체는 서명 세션에서만").isEqualTo(USER.toString()));
    }

    @Test
    @DisplayName("현재 섬이 없으면 임의로 고르지 않고 409 — 섬·조각을 부르지 않는다(BG01)")
    void noCurrentIslandIsConflict() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":null}"));

        mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("STATE_CONFLICT"))
                .andExpect(jsonPath("$.error.field").value("currentIslandId"));
        assertThat(DATA.hits(DATA_ISLAND) + DATA.hits(DATA_SUMMARY) + DATA.hits(DATA_CURRENT)).isZero();
    }

    @Test
    @DisplayName("섬 문맥의 도메인 403 은 화면 전체 403 — 뒤 조각을 부르지 않는다")
    void islandForbiddenFailsWholeScreen() throws Exception {
        DATA.on(DATA_ISLAND, request -> new MockUpstream.Response(403,
                "{\"code\":\"MEMBER_ONLY\",\"message\":\"private detail\"}"));

        String body = mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("private detail");
        assertThat(DATA.hits(DATA_SUMMARY) + DATA.hits(DATA_CURRENT)).isZero();
    }

    @Test
    @DisplayName("현재 섬이 방문자 요약으로 오면(소속 상실) 화면 전체 403")
    void visitorScopeIsForbidden() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"visitor\",\"member\":null,\"visitor\":{\"id\":\"" + ISLAND
                + "\",\"name\":\"모래섬\",\"intro\":\"\",\"visibility\":\"public\",\"approvalRequired\":false,"
                + "\"memberCount\":1,\"membershipStatus\":\"none\",\"joinRequestId\":null,"
                + "\"growthStage\":null,\"themeId\":null}}"));

        mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.field").value("islandId"));
    }

    @Test
    @DisplayName("필수 조각의 상류 계약 위반은 화면 전체 502 — 빈 조각 200 으로 줄이지 않는다")
    void requiredFragmentFailureFailsWholeScreen() throws Exception {
        // 일시 5xx 는 공유 서킷을 열어 다른 계약 테스트를 오염시키므로 여기서 재현하지 않는다 — 조합기의
        // 503/504 분류는 HttpExecutionIntegrationTest 가 전용 클라이언트로 본다.
        DATA.on(DATA_SUMMARY, request -> new MockUpstream.Response(400, "{\"code\":\"UNKNOWN\",\"message\":\"x\"}"));
        mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));

        DATA.on(DATA_SUMMARY, request -> ok(SUMMARY));
        DATA.on(DATA_CURRENT, request -> ok("{}"));
        mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    @DisplayName("허용 밖 query·같은 키 반복·세션 없는 토큰은 상류를 부르지 않는다")
    void rejectsBeforeTheNetwork() throws Exception {
        mockMvc.perform(auth(get("/screens/home")).queryParam("cursor", "x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").doesNotExist());
        mockMvc.perform(auth(get("/screens/home")).queryParam("date", "2026-09-17").queryParam("date", "2026-09-18"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("date"));
        mockMvc.perform(get("/screens/home").header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/screens/home"))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }
}
