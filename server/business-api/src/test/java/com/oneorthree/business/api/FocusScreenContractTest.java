package com.oneorthree.business.api;

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
 * {@code GET /screens/focus} 계약 (GROMO-1897) — 현재 세션 → (세션 섬 | 현재 섬) 상세 → 집중 주민.
 * 세션이 있으면 현재 섬이 아니라 세션이 고정한 섬을 연다. 그 섬의 방송기가 완공이면 방송기를 싣는다.
 */
class FocusScreenContractTest extends ScreenContractTestBase {

    private static final UUID FOCUS = UUID.fromString("dddddddd-1897-0000-0000-000000000002");
    private static final UUID SESSION_ISLAND = UUID.fromString("cccccccc-1897-0000-0000-000000000003");
    private static final String DATA_CURRENT = "GET " + USERS + "/focus-sessions/current";

    private static final String PLAYBACK = "{\"trackId\":null,\"playing\":false,\"positionSeconds\":0,"
            + "\"effectiveAt\":\"2026-09-17T00:00:00Z\",\"changedBy\":null,\"version\":0,"
            + "\"serverNow\":\"2026-09-17T00:00:00Z\",\"durationSeconds\":null}";

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void islands() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        for (UUID island : new UUID[] {ISLAND, SESSION_ISLAND}) {
            DATA.on(island(island), request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":"
                    + detail(island) + "}"));
            DATA.on(members(island), request -> ok(focusMembers(island)));
            DATA.on(options(island), request -> ok(options(false)));
            DATA.on(playback(island), request -> ok(PLAYBACK));
        }
    }

    @Test
    @DisplayName("세션이 있으면 세션 섬을 열고 현재 섬 목록은 부르지 않는다 — 방송기도 세션 섬의 것이다")
    void sessionPinsTheIsland() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":" + session(SESSION_ISLAND) + "}"));

        MvcResult result = mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(SESSION_ISLAND.toString()))
                .andExpect(jsonPath("$.data.session.id").value(FOCUS.toString()))
                .andExpect(jsonPath("$.data.session.version").value(1))
                .andExpect(jsonPath("$.data.focusMembers.items[0].userId").value(USER.toString()))
                .andExpect(jsonPath("$.data.focusMembers.watermarks[0].projection").value("focus.member"))
                .andExpect(jsonPath("$.data.focusMembers.watermarks[0].islandId").value(SESSION_ISLAND.toString()))
                .andExpect(jsonPath("$.data.playbackAvailability").value("available"))
                .andExpect(jsonPath("$.data.playback.version").value(0))
                .andReturn();

        assertKeys(result, "island", "session", "focusMembers", "playback", "playbackAvailability");
        JsonNode playback = JSON.readTree(result.getResponse().getContentAsString()).get("data").get("playback");
        assertThat(playback.get("trackId").isNull()).as("정상 미선택도 available + 객체다(policy §availability)")
                .isTrue();
        assertThat(DATA.hits(DATA_MINE)).isZero();
        assertThat(DATA.hits(members(ISLAND)) + DATA.hits(options(ISLAND)) + DATA.hits(playback(ISLAND))).isZero();
        assertThat(DATA.hits(playback(SESSION_ISLAND))).isOne();
    }

    @Test
    @DisplayName("세션이 없으면 session:null 정상값이고 현재 섬을 연다")
    void noSessionUsesCurrentIsland() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));

        String body = mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.focusMembers.watermarks[0].islandId").value(ISLAND.toString()))
                .andReturn().getResponse().getContentAsString();

        JsonNode data = JSON.readTree(body).get("data");
        assertThat(data.has("session") && data.get("session").isNull()).isTrue();
        assertThat(DATA.hits(members(SESSION_ISLAND))).isZero();
    }

    @Test
    @DisplayName("방송기 미완공이면 playback 을 부르지 않고 조각만 facility_locked — 화면은 200")
    void gramNotBuiltLocksOnlyThePlaybackFragment() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        DATA.on(options(ISLAND), request -> ok(options(true)));

        MvcResult result = mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.playbackAvailability").value("facility_locked"))
                .andExpect(jsonPath("$.data.focusMembers.items[0].userId").value(USER.toString()))
                .andReturn();

        assertKeys(result, "island", "session", "focusMembers", "playback", "playbackAvailability");
        assertThat(JSON.readTree(result.getResponse().getContentAsString()).get("data").get("playback").isNull())
                .isTrue();
        assertThat(DATA.hits(playback(ISLAND))).as("N 은 호출 자체를 생략한다(B03)").isZero();
    }

    @Test
    @DisplayName("완공 판정 뒤 방송기 도메인 403 은 facility_locked 로 접지 않고 화면 전체 403 이다(B03)")
    void playbackForbiddenAfterCheckFailsWholeScreen() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        DATA.on(playback(ISLAND), request -> domainError(403, "GRAM_LOCKED"));

        mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
    }

    @Test
    @DisplayName("집중 주민의 도메인 403 은 화면 전체 403 이다")
    void focusMembersForbiddenFailsWholeScreen() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        DATA.on(members(ISLAND), request -> domainError(403, "MEMBER_ONLY"));

        mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.field").value("islandId"));
    }

    @Test
    @DisplayName("필수 조각이 시간 초과면 빈 조각 200 이 아니라 화면 전체 504 다")
    void fragmentTimeoutIs504() throws Exception {
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        // ci 의 read-timeout 은 300ms 다 — 매 시도를 그보다 길게 붙든다. 실패 2회는 서킷 임계(5) 아래이고 다음
        // 성공이 되돌린다. 3초 화면 예산 소진은 ScreenDeadlineContractTest 가 별도 컨텍스트로 본다.
        DATA.on(members(ISLAND), request -> {
            pause(350);
            return ok(focusMembers(ISLAND));
        });

        mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isGatewayTimeout())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_TIMEOUT"));
        // mock 상류는 스레드 하나다 — 붙든 시도가 끝날 때까지 기다려 다음 테스트 요청이 줄 서지 않게 한다.
        pause(400);
    }

    @Test
    @DisplayName("query 는 받지 않는다 — 400, 상류 호출 없음")
    void rejectsAnyQuery() throws Exception {
        mockMvc.perform(auth(get("/screens/focus")).queryParam("islandId", ISLAND.toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        assertThat(DATA.received()).isEmpty();
    }

    private static void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static String island(UUID island) {
        return "GET /internal/islands/" + island;
    }

    private static String members(UUID island) {
        return "GET /internal/islands/" + island + "/focus-members";
    }

    private static String options(UUID island) {
        return "GET /internal/islands/" + island + "/construction-options";
    }

    private static String playback(UUID island) {
        return "GET /internal/islands/" + island + "/playback";
    }

    /** 건설 옵션 — items 는 미완공 건물만 담는다. gram 이 있으면 방송기 미완공이다. */
    private static String options(boolean gramPending) {
        String items = gramPending ? "{\"id\":\"gram\",\"name\":\"방송기\",\"cost\":1360,"
                + "\"currency\":\"village_points\",\"selectable\":true,\"buildable\":false,\"blockedReason\":null}" : "";
        return "{\"islandVersion\":4,\"costPolicyVersion\":1,\"selectedBuildingId\":null,\"villagePoints\":0,"
                + "\"walletVersion\":7,\"items\":[" + items + "]}";
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
}
