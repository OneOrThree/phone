package com.oneorthree.business.api;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/home} 요청 1건이 상류에 내는 호출 수와 라운드 (GROMO-2345) — 차단 목록은 요청당 1회다. 응답 모양은 {@link HomeScreenContractTest} 가 고정한다.
 */
class HomeScreenCallBudgetTest extends ScreenContractTestBase {

    private static final UUID OTHER = UUID.fromString("eeeeeeee-2345-0000-0000-000000000001");
    private static final String ISLAND_PATH = "GET /internal/islands/" + ISLAND;
    private static final String BLOCKS = "GET " + USERS + "/blocks";

    @Test
    @DisplayName("주민 목록과 건설 옵션이 모두 차단 목록을 필요로 해도 Data 의 blocks 는 요청당 1회, 총 호출은 11회")
    void blocksReadOnceAndCallCountFixed() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(ISLAND_PATH, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":"
                + FacilityFixtures.detail() + "}"));
        DATA.on("GET " + USERS + "/focus-summary", request -> ok("{\"date\":\"2026-09-17\",\"completedSeconds\":60,"
                + "\"currentSessionSecondsToday\":30,\"totalSeconds\":90,\"serverNow\":\"2026-09-17T00:00:00Z\"}"));
        DATA.on("GET " + USERS + "/focus-sessions/current", request -> ok("{\"session\":null}"));
        DATA.on(ISLAND_PATH + "/rest-members", request -> ok("{\"items\":[],\"serverNow\":\"2026-09-17T00:00:00Z\","
                + "\"watermarks\":[]}"));
        DATA.on(ISLAND_PATH + "/members", request -> ok("{\"items\":[{\"id\":\"" + OTHER + "\",\"name\":\"상대\","
                + "\"role\":\"member\",\"appearance\":{\"clothes\":\"scarf\",\"decor\":null,"
                + "\"hull\":\"raft\",\"position\":\"front\",\"version\":2}}],\"nextJoinedAt\":null,\"nextMembershipId\":null,\"version\":9}"));
        DATA.on(ISLAND_PATH + "/shop/wallets", request -> ok(FacilityFixtures.WALLETS));
        DATA.on(ISLAND_PATH + "/layout", request -> ok("{\"layoutRevision\":4,\"layout\":{\"schemaVersion\":1,\"mapId\":\"home\",\"buildings\":[]}}"));
        String progress = "\"residentProgress\":{\"buildingId\":\"gram\",\"requiredPerResident\":1,\"residents\":["
                + "{\"userId\":\"" + OTHER + "\",\"name\":\"상대\",\"contributed\":0,\"remaining\":1}]}";
        DATA.on(ISLAND_PATH + "/construction-options",
                request -> ok("{" + progress + "," + FacilityFixtures.options("library").substring(1)));
        DATA.on(ISLAND_PATH + "/playback", request -> ok("{\"trackId\":\"campfire\",\"playing\":true,"
                + "\"positionSeconds\":12,\"effectiveAt\":\"2026-09-17T00:00:00Z\",\"changedBy\":\"" + USER
                + "\",\"version\":3,\"serverNow\":\"2026-09-17T00:00:00Z\",\"durationSeconds\":120.5}"));
        DATA.on(BLOCKS, request -> ok("[{\"id\":\"" + OTHER + "\"}]"));

        String body = mockMvc.perform(auth(get("/screens/home")).queryParam("date", "2026-09-17")
                        .queryParam("timezone", "Asia/Seoul"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        JsonNode data = new ObjectMapper().readTree(body).get("data");
        assertThat(data.get("members").get("items").get(0).get("name").asString())
                .as("차단 목록을 공유해도 중립 치환은 그대로").isEqualTo("차단한 주민");
        assertThat(DATA.hits(BLOCKS)).as("members·construction-options 가 같은 차단 목록을 쓴다").isOne();
        assertThat(DATA.received()).as("mine·island·summary·current·rest·members·wallets·options·layout·blocks·playback")
                .hasSize(11);
    }
}
