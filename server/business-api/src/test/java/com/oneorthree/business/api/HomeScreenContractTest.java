package com.oneorthree.business.api;

import com.oneorthree.business.support.Tokens;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/home} 계약 (GROMO-1897) — 섬 문맥(현재 섬 → 주민 상세) 뒤 집중 요약·현재 세션·휴식 주민·
 * 방송기 완공 판정 병렬, 완공이면 방송기.
 */
class HomeScreenContractTest extends ScreenContractTestBase {

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_SUMMARY = "GET " + USERS + "/focus-summary";
    private static final String DATA_CURRENT = "GET " + USERS + "/focus-sessions/current";
    private static final String DATA_REST = DATA_ISLAND + "/rest-members";
    private static final String DATA_OPTIONS = DATA_ISLAND + "/construction-options";
    private static final String DATA_PLAYBACK = DATA_ISLAND + "/playback";
    private static final String DATA_WALLETS = DATA_ISLAND + "/shop/wallets";

    private static final String DETAIL = "{\"id\":\"" + ISLAND + "\",\"name\":\"모래섬\",\"intro\":\"\","
            + "\"visibility\":\"public\",\"approvalRequired\":false,\"memberCount\":1,\"maxMembers\":15,"
            + "\"membershipStatus\":\"active\",\"growthStage\":null,\"themeId\":null,"
            + "\"role\":\"host\",\"version\":3}";
    private static final String SUMMARY = "{\"date\":\"2026-09-17\",\"completedSeconds\":60,"
            + "\"currentSessionSecondsToday\":30,\"totalSeconds\":90,\"serverNow\":\"2026-09-17T00:00:00Z\"}";
    private static final String REST = "{\"items\":[{\"userId\":\"" + USER + "\",\"name\":\"수아\","
            + "\"restSeat\":1,\"restStartedAt\":\"2026-09-17T00:00:00Z\"}],"
            + "\"serverNow\":\"2026-09-17T00:00:00Z\","
            + "\"watermarks\":[{\"projection\":\"rest.member\",\"islandId\":\"" + ISLAND + "\","
            + "\"aggregateId\":\"" + USER + "\",\"version\":2}]}";

    private static final String PLAYBACK = "{\"trackId\":\"campfire\",\"playing\":true,\"positionSeconds\":12,"
            + "\"effectiveAt\":\"2026-09-17T00:00:00Z\",\"changedBy\":\"" + USER + "\",\"version\":3,"
            + "\"serverNow\":\"2026-09-17T00:00:00Z\",\"durationSeconds\":120.5}";

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void currentIsland() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + DETAIL + "}"));
        DATA.on(DATA_SUMMARY, request -> ok(SUMMARY));
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        DATA.on(DATA_REST, request -> ok(REST));
        DATA.on(DATA_OPTIONS, request -> ok(options(false)));
        DATA.on(DATA_PLAYBACK, request -> ok(PLAYBACK));
        DATA.on(DATA_WALLETS, request -> ok(FacilityFixtures.WALLETS));
    }

    @Test
    @DisplayName("정상: 조각 이름이 응답 키이고 도메인 DTO 를 그대로 싣는다 — 방송기 완공이면 playback, 지갑은 상점 GET 그대로")
    void composesFragmentsUnderTheirNames() throws Exception {
        MvcResult result = mockMvc.perform(auth(get("/screens/home")).queryParam("date", "2026-09-17")
                        .queryParam("timezone", "Asia/Seoul").header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.island.role").value("host"))
                .andExpect(jsonPath("$.data.island.version").value(3))
                .andExpect(jsonPath("$.data.focusSummary.totalSeconds").value(90))
                .andExpect(jsonPath("$.data.focusSummary.serverNow").value("2026-09-17T00:00:00Z"))
                .andExpect(jsonPath("$.data.restMembers.items[0].restSeat").value(1))
                .andExpect(jsonPath("$.data.restMembers.watermarks[0].projection").value("rest.member"))
                .andExpect(jsonPath("$.data.playbackAvailability").value("available"))
                .andExpect(jsonPath("$.data.playback.trackId").value("campfire"))
                .andExpect(jsonPath("$.data.playback.version").value(3))
                .andExpect(jsonPath("$.data.wallets.villagePoints").value(1500))
                .andExpect(jsonPath("$.data.wallets.villagePointsVersion").value(7))
                .andReturn();

        assertKeys(result, "island", "focusSummary", "session", "restMembers", "wallets", "playback",
                "playbackAvailability");
        JsonNode data = JSON.readTree(result.getResponse().getContentAsString()).get("data");
        assertThat(data.get("session").isNull()).as("session 은 명시 null").isTrue();
        assertThat(data.get("wallets").get("fishVersion").isNull()).as("개인 지갑 version 은 지어내지 않는다").isTrue();
        assertThat(DATA.hits(DATA_REST)).as("BG11 결정 — 현재 섬의 휴식 주민을 싣는다").isOne();
        assertThat(DATA.receivedFor(DATA_SUMMARY).get(0).query()).contains("date=2026-09-17", "timezone=Asia/Seoul");
        assertThat(DATA.received()).allSatisfy(forwarded ->
                assertThat(forwarded.header("x-user-id")).as("주체는 서명 세션에서만").isEqualTo(USER.toString()));
    }

    @Test
    @DisplayName("방송기 미완공이면 playback 을 부르지 않고 조각만 facility_locked — 화면은 200")
    void gramNotBuiltLocksOnlyThePlaybackFragment() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(options(true)));

        MvcResult result = mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.playbackAvailability").value("facility_locked"))
                .andExpect(jsonPath("$.data.focusSummary.totalSeconds").value(90))
                .andReturn();

        assertKeys(result, "island", "focusSummary", "session", "restMembers", "wallets", "playback",
                "playbackAvailability");
        assertThat(JSON.readTree(result.getResponse().getContentAsString()).get("data").get("playback").isNull())
                .isTrue();
        assertThat(DATA.hits(DATA_PLAYBACK)).as("N 은 호출 자체를 생략한다(B03)").isZero();
    }

    @Test
    @DisplayName("완공 판정 뒤 방송기 도메인 403 은 facility_locked 로 접지 않고 화면 전체 403 이다(B03)")
    void playbackForbiddenAfterCheckFailsWholeScreen() throws Exception {
        DATA.on(DATA_PLAYBACK, request -> domainError(403, "GRAM_LOCKED"));

        mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
    }

    @Test
    @DisplayName("방송기 완공 판정(건설 옵션)의 도메인 403 은 화면 전체 403 이다")
    void gramCheckForbiddenFailsWholeScreen() throws Exception {
        DATA.on(DATA_OPTIONS, request -> domainError(403, "MEMBER_ONLY"));

        mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        assertThat(DATA.hits(DATA_PLAYBACK)).isZero();
    }

    @Test
    @DisplayName("현재 섬이 없으면 임의로 고르지 않고 409 — 섬·조각을 부르지 않는다(BG01)")
    void noCurrentIslandIsConflict() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":null}"));

        mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("STATE_CONFLICT"))
                .andExpect(jsonPath("$.error.field").value("currentIslandId"));
        assertThat(DATA.hits(DATA_ISLAND) + DATA.hits(DATA_SUMMARY) + DATA.hits(DATA_CURRENT)
                + DATA.hits(DATA_REST) + DATA.hits(DATA_OPTIONS) + DATA.hits(DATA_PLAYBACK)).isZero();
    }

    @Test
    @DisplayName("섬 문맥의 도메인 403 은 화면 전체 403 — 뒤 조각을 부르지 않는다")
    void islandForbiddenFailsWholeScreen() throws Exception {
        DATA.on(DATA_ISLAND, request -> domainError(403, "MEMBER_ONLY"));

        String body = mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("internal detail");
        assertThat(DATA.hits(DATA_SUMMARY) + DATA.hits(DATA_CURRENT) + DATA.hits(DATA_REST)
                + DATA.hits(DATA_OPTIONS) + DATA.hits(DATA_PLAYBACK)).isZero();
    }

    @Test
    @DisplayName("휴식 주민의 도메인 403 은 화면 전체 403 이다 — 빈 목록으로 줄이지 않는다")
    void restMembersForbiddenFailsWholeScreen() throws Exception {
        DATA.on(DATA_REST, request -> domainError(403, "MEMBER_ONLY"));

        mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.field").value("islandId"));
    }

    @Test
    @DisplayName("현재 섬이 방문자 요약으로 오면(소속 상실) 화면 전체 403")
    void visitorScopeIsForbidden() throws Exception {
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"visitor\",\"member\":null,\"visitor\":"
                + summary("none", null) + "}"));

        mockMvc.perform(auth(get("/screens/home")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.field").value("islandId"));
    }

    @Test
    @DisplayName("필수 조각의 상류 계약 위반은 화면 전체 502 — 빈 조각 200 으로 줄이지 않는다")
    void requiredFragmentFailureFailsWholeScreen() throws Exception {
        // 일시 5xx 는 공유 서킷을 열어 다른 계약 테스트를 오염시키므로 여기서 재현하지 않는다 —
        // 전체 예산 소진은 ScreenDeadlineContractTest 가 별도 컨텍스트로 본다.
        DATA.on(DATA_SUMMARY, request -> domainError(400, "UNKNOWN"));
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
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        mockMvc.perform(auth(get("/screens/home")).queryParam("date", "2026-09-17").queryParam("date", "2026-09-18"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("date"));
        mockMvc.perform(get("/screens/home").header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/screens/home"))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    /** 건설 옵션 — items 는 미완공 건물만 담는다. gram 이 있으면 방송기 미완공이다. */
    private static String options(boolean gramPending) {
        String item = "{\"id\":\"%s\",\"name\":\"시설\",\"cost\":1360,\"currency\":\"village_points\","
                + "\"selectable\":true,\"buildable\":false,\"blockedReason\":null}";
        String items = gramPending ? String.format(item, "gram") + "," + String.format(item, "library")
                : String.format(item, "library");
        return "{\"islandVersion\":4,\"costPolicyVersion\":1,\"selectedBuildingId\":null,\"villagePoints\":0,"
                + "\"walletVersion\":7,\"items\":[" + items + "]}";
    }
}
