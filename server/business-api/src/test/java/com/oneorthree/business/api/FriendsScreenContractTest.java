package com.oneorthree.business.api;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** {@code GET /screens/friends} (GROMO-1899) — 친구 목록 · 받은 요청 · 보낸 요청 병렬. 현재 섬이 필요 없다. */
class FriendsScreenContractTest extends ScreenContractTestBase {

    private static final UUID PEER = UUID.fromString("aaaaaaaa-1899-0000-0000-000000000013");
    private static final String DATA_FRIENDS = "GET " + USERS + "/friends";
    private static final String DATA_REQUESTS = "GET " + USERS + "/friend-requests";
    private static final String FRIENDS = "[{\"userId\":\"" + PEER + "\",\"nickname\":\"짝꿍\",\"tierLevel\":3,"
            + "\"occupation\":\"CODING\",\"isPinned\":true,\"isFocusing\":true,\"focusTimeMinutes\":42,"
            + "\"focusStartedAt\":\"2026-09-18T01:00:00Z\",\"focusTagName\":\"전공\","
            + "\"mainIslandName\":\"모래섬\"}]";

    private static String requestItem(String nickname) {
        return "[{\"requestId\":\"" + UUID.randomUUID() + "\",\"userId\":\"" + UUID.randomUUID()
                + "\",\"nickname\":\"" + nickname + "\",\"tierLevel\":null,\"createdAt\":\"2026-09-18T01:00:00Z\"}]";
    }

    @BeforeEach
    void stub() {
        DATA.on(DATA_FRIENDS, request -> ok(FRIENDS));
        DATA.on(DATA_REQUESTS, request -> ok(requestItem(
                "type=received".equals(request.query()) ? "받은" : "보낸")));
    }

    @Test
    void composesFriendsAndBothRequestDirections() throws Exception {
        MvcResult result = mockMvc.perform(auth(get("/screens/friends")).queryParam("date", "2026-09-18"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.friends[0].userId").value(PEER.toString()))
                .andExpect(jsonPath("$.data.friends[0].isPinned").value(true))
                .andExpect(jsonPath("$.data.friends[0].focusTimeMinutes").value(42))
                .andExpect(jsonPath("$.data.friends[0].mainIslandName").value("모래섬"))
                .andExpect(jsonPath("$.data.friendRequests[0].nickname").value("받은"))
                .andExpect(jsonPath("$.data.sentFriendRequests[0].nickname").value("보낸"))
                .andReturn();
        assertKeys(result, "friends", "friendRequests", "sentFriendRequests");
        assertThat(DATA.receivedFor(DATA_FRIENDS).get(0).query()).isEqualTo("date=2026-09-18");
        assertThat(DATA.receivedFor(DATA_REQUESTS)).extracting(request -> request.query())
                .containsExactlyInAnyOrder("type=received", "type=sent");
        assertThat(DATA.hits(DATA_MINE)).as("현재 섬을 읽지 않는다").isZero();
    }

    @Test
    void requiredFragmentFailureFailsTheWholeScreen() throws Exception {
        DATA.on(DATA_REQUESTS, request -> domainError(404, "USER_NOT_FOUND"));
        mockMvc.perform(auth(get("/screens/friends")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("USER_NOT_FOUND"));

        stub();
        DATA.on(DATA_FRIENDS, request -> domainError(400, "INVALID_PARAMETER"));
        mockMvc.perform(auth(get("/screens/friends")).queryParam("date", "bad"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("date"));
    }

    @Test
    void rejectsUnknownOrRepeatedQuery() throws Exception {
        mockMvc.perform(auth(get("/screens/friends")).queryParam("type", "sent"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        mockMvc.perform(auth(get("/screens/friends")).queryParam("date", "2026-09-18", "2026-09-19"))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }
}
