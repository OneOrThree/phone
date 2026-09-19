package com.oneorthree.business.api;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/board} 계약 (GROMO-1898) — 섬 문맥 뒤 현재 퀘스트·공지 첫 페이지 병렬. 게시판 미완공은
 * 도메인 게이트의 403 이 그대로 화면 전체 403 이다.
 */
class BoardScreenContractTest extends ScreenContractTestBase {

    private static final UUID QUEST = UUID.fromString("dddddddd-1898-0000-0000-000000000001");
    private static final UUID OCCURRENCE = UUID.fromString("eeeeeeee-1898-0000-0000-000000000001");
    private static final UUID NOTICE = UUID.fromString("01990000-1898-7000-8000-000000000001");

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_QUESTS = DATA_ISLAND + "/quests/current";
    private static final String DATA_NOTICES = DATA_ISLAND + "/notices";

    private static final String QUESTS = "{\"items\":[{\"id\":\"" + QUEST + "\",\"occurrenceId\":\"" + OCCURRENCE
            + "\",\"title\":\"저녁 30분 집중\",\"type\":\"focus\",\"windowStart\":\"18:00\",\"windowEnd\":\"23:00\","
            + "\"timezone\":\"UTC\",\"date\":\"2026-09-19\",\"targetMinutes\":30,\"myRate\":60,"
            + "\"reward\":{\"currency\":\"village_points\",\"amount\":30},\"settlementStatus\":\"in_progress\","
            + "\"claimable\":false,\"claimBlockedReason\":\"MEMBERS_INCOMPLETE\",\"claimed\":false,\"version\":1}]}";
    private static final String NOTICES = "{\"items\":[{\"id\":\"" + NOTICE + "\",\"title\":\"환영해요\","
            + "\"commentCount\":1,\"createdAt\":\"2026-09-19T00:00:00.123456Z\"}],\"hasMore\":true}";

    @BeforeEach
    void island() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + FacilityFixtures.detail()
                + "}"));
        DATA.on(DATA_QUESTS, request -> ok(QUESTS));
        DATA.on(DATA_NOTICES, request -> ok(NOTICES));
    }

    @Test
    @DisplayName("정상: 퀘스트·공지 첫 페이지(도메인과 같은 서명 커서) — wallets 는 null + missingFragments")
    void composesQuestsAndNotices() throws Exception {
        MvcResult result = mockMvc.perform(auth(get("/screens/board")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.quests.items[0].id").value(QUEST.toString()))
                .andExpect(jsonPath("$.data.quests.items[0].version").value(1))
                .andExpect(jsonPath("$.data.notices.items[0].id").value(NOTICE.toString()))
                .andExpect(jsonPath("$.data.notices.items[0].createdAt").doesNotExist())
                .andExpect(jsonPath("$.data.notices.nextCursor").isString())
                .andExpect(jsonPath("$.data.wallets").value(nullValue()))
                .andExpect(jsonPath("$.data.missingFragments.length()").value(1))
                .andExpect(jsonPath("$.data.missingFragments[0]").value("wallets"))
                .andReturn();

        assertKeys(result, "island", "quests", "notices", "wallets", "missingFragments");
        assertThat(DATA.receivedFor(DATA_NOTICES).get(0).query()).contains("limit=30");
        assertThat(DATA.received()).allSatisfy(forwarded ->
                assertThat(forwarded.header("x-user-id")).as("주체는 서명 세션에서만").isEqualTo(USER.toString()));
    }

    @Test
    @DisplayName("공지로 발행한 커서를 도메인 GET 이 그대로 이어받는다(B10)")
    void noticeCursorContinuesOnDomainGet() throws Exception {
        String body = mockMvc.perform(auth(get("/screens/board")))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String cursor = JsonPath.read(body, "$.data.notices.nextCursor");
        DATA.on(DATA_NOTICES, request -> ok("{\"items\":[],\"hasMore\":false}"));

        mockMvc.perform(auth(get("/islands/" + ISLAND + "/notices")).queryParam("cursor", cursor))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_NOTICES).get(1).query()).contains("afterId=" + NOTICE);
    }

    @Test
    @DisplayName("게시판 미완공(도메인 BOARD_LOCKED)은 화면 전체 403 FACILITY_LOCKED")
    void boardLockedFailsWholeScreen() throws Exception {
        DATA.on(DATA_NOTICES, request -> domainError(403, "BOARD_LOCKED"));
        DATA.on(DATA_QUESTS, request -> domainError(403, "QUEST_BOARD_LOCKED"));

        mockMvc.perform(auth(get("/screens/board")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
    }

    @Test
    @DisplayName("현재 섬이 없으면 409 — 조각을 부르지 않는다. query 는 받지 않는다")
    void noCurrentIslandAndQueryRejected() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":null}"));
        mockMvc.perform(auth(get("/screens/board")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.field").value("currentIslandId"));
        assertThat(DATA.hits(DATA_QUESTS) + DATA.hits(DATA_NOTICES)).isZero();

        mockMvc.perform(auth(get("/screens/board")).queryParam("cursor", "x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
    }
}
