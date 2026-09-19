package com.oneorthree.business.api;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** {@code GET /screens/raft} — me · inventory · friendRequests(받은 요청) 병렬. 현재 섬이 필요 없다. */
class RaftScreenContractTest extends ScreenContractTestBase {

    private static final String DATA_INVENTORY = "GET " + USERS + "/inventory";
    private static final String DATA_REQUESTS = "GET " + USERS + "/friend-requests";
    private static final String INVENTORY = "{\"clothes\":[\"jacket\"],\"decor\":[],\"hulls\":[\"raft\"],"
            + "\"inventoryVersion\":3,\"equipped\":{\"clothes\":\"jacket\",\"decor\":null,\"hull\":\"raft\","
            + "\"position\":\"front\",\"version\":2}}";

    private static String requestItem() {
        return "{\"requestId\":\"" + UUID.randomUUID() + "\",\"userId\":\"" + UUID.randomUUID()
                + "\",\"nickname\":\"짝꿍\",\"tierLevel\":null,\"createdAt\":\"2026-09-18T01:00:00Z\"}";
    }

    private void stubAll(String requests) {
        DATA.on(DATA_ME, request -> ok(ME));
        DATA.on(DATA_INVENTORY, request -> ok(INVENTORY));
        DATA.on(DATA_REQUESTS, request -> ok(requests));
    }

    @Test
    void composesMeInventoryAndReceivedRequests() throws Exception {
        stubAll("[" + requestItem() + "," + requestItem() + "]");
        MvcResult result = mockMvc.perform(auth(get("/screens/raft")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.me.id").value(USER.toString()))
                .andExpect(jsonPath("$.data.inventory.inventoryVersion").value(3))
                .andExpect(jsonPath("$.data.inventory.equipped.version").value(2))
                .andExpect(jsonPath("$.data.friendRequests.length()").value(2))
                .andReturn();
        assertKeys(result, "me", "inventory", "friendRequests");
        assertThat(DATA.receivedFor(DATA_REQUESTS).get(0).query()).isEqualTo("type=received");
        assertThat(DATA.hits("GET " + USERS + "/islands")).as("현재 섬을 읽지 않는다").isZero();
    }

    @Test
    void noPendingRequestsIsAnEmptyList() throws Exception {
        stubAll("[]");
        mockMvc.perform(auth(get("/screens/raft")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.friendRequests").isEmpty());
    }

    @Test
    void requiredFragmentFailureFailsTheWholeScreen() throws Exception {
        stubAll("[]");
        DATA.on(DATA_REQUESTS, request -> domainError(404, "USER_NOT_FOUND"));
        mockMvc.perform(auth(get("/screens/raft")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("USER_NOT_FOUND"));

        stubAll("[]");
        DATA.on(DATA_INVENTORY, request -> ok(""));
        mockMvc.perform(auth(get("/screens/raft")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }
}
