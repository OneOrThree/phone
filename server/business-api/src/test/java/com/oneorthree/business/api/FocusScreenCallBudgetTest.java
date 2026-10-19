package com.oneorthree.business.api;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/focus} 호출 수 (GROMO-2345) — focus-members 와 construction-options 가 모두 차단 목록을
 * 필요로 해도 Data 의 {@code /blocks} 는 요청당 1회다. 느린 응답으로 두 조각이 동시에 들어오는 경합을 만든다.
 */
class FocusScreenCallBudgetTest extends ScreenContractTestBase {

    private static final UUID OTHER = UUID.fromString("eeeeeeee-2345-0000-0000-000000000002");
    private static final String ISLAND_PATH = "GET /internal/islands/" + ISLAND;
    private static final String BLOCKS = "GET " + USERS + "/blocks";

    @Test
    @DisplayName("focus-members 와 construction-options 가 모두 차단 목록을 써도 /blocks 는 요청당 1회, 총 호출 7회")
    void blocksReadOnceUnderConcurrency() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on("GET " + USERS + "/focus-sessions/current", request -> ok("{\"session\":null}"));
        DATA.on(ISLAND_PATH, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":"
                + FacilityFixtures.detail() + "}"));
        DATA.on(ISLAND_PATH + "/focus-members", request -> ok("{\"items\":[{\"userId\":\"" + OTHER
                + "\",\"name\":\"상대\",\"sessionId\":\"" + UUID.randomUUID() + "\",\"subject\":\"독서\","
                + "\"activeSeconds\":10,\"status\":\"active\"}],\"serverNow\":\"2026-09-17T00:00:00Z\","
                + "\"watermarks\":[]}"));
        String progress = "\"residentProgress\":{\"buildingId\":\"gram\",\"requiredPerResident\":1,\"residents\":["
                + "{\"userId\":\"" + OTHER + "\",\"name\":\"상대\",\"contributed\":0,\"remaining\":1}]}";
        DATA.on(ISLAND_PATH + "/construction-options",
                request -> ok("{" + progress + "," + FacilityFixtures.options("library").substring(1)));
        DATA.on(ISLAND_PATH + "/playback", request -> ok("{\"trackId\":null,\"playing\":false,"
                + "\"positionSeconds\":0,\"effectiveAt\":\"2026-09-17T00:00:00Z\",\"changedBy\":null,"
                + "\"version\":0,\"serverNow\":\"2026-09-17T00:00:00Z\",\"durationSeconds\":null}"));
        DATA.on(BLOCKS, request -> {
            try {
                Thread.sleep(150);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return ok("[{\"id\":\"" + OTHER + "\"}]");
        });

        String body = mockMvc.perform(auth(get("/screens/focus")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        assertThat(new ObjectMapper().readTree(body).get("data").get("focusMembers").get("items").get(0)
                .get("name").asString()).as("차단 목록을 공유해도 중립 치환은 그대로").isEqualTo("차단한 주민");
        assertThat(DATA.hits(BLOCKS)).isOne();
        assertThat(DATA.received()).as("mine·current·island·focus-members·options·blocks·playback").hasSize(7);
    }
}
