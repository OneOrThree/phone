package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** {@code GET /screens/launch} — me · memberships · session 병렬 (implementation-business-api §4). */
class LaunchScreenContractTest extends ScreenContractTestBase {

    private static final UUID FOCUS = UUID.fromString("eeeeeeee-1896-0000-0000-000000000001");
    private static final String DATA_CURRENT = "GET " + USERS + "/focus-sessions/current";
    private static final String STATE = "{\"id\":\"" + FOCUS + "\",\"islandId\":\"" + ISLAND + "\","
            + "\"subject\":\"알고리즘\",\"targetMinutes\":60,\"status\":\"active\",\"activeSeconds\":0,"
            + "\"serverNow\":\"2026-09-17T00:00:00Z\",\"startedAt\":\"2026-09-17T00:00:00Z\","
            + "\"restStartedAt\":null,\"version\":1}";

    private void stubAll(String session) {
        DATA.on(DATA_ME, request -> ok(ME));
        DATA.on(DATA_MINE, request -> ok("{\"items\":[" + summary("active", null) + "],\"currentIslandId\":\""
                + ISLAND + "\"}"));
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":" + session + "}"));
    }

    @Test
    void composesThreeDomainFragmentsWithNoStore() throws Exception {
        stubAll(STATE);
        MvcResult result = mockMvc.perform(auth(get("/screens/launch")).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.me.id").value(USER.toString()))
                .andExpect(jsonPath("$.data.me.linkedProviders[0]").value("apple"))
                .andExpect(jsonPath("$.data.memberships.items[0].id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.memberships.currentIslandId").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.session.id").value(FOCUS.toString()))
                .andExpect(jsonPath("$.data.session.version").value(1))
                .andReturn();
        assertKeys(result, "me", "memberships", "session");
        for (String route : new String[] {DATA_ME, DATA_MINE, DATA_CURRENT}) {
            assertThat(DATA.hits(route)).as(route).isEqualTo(1);
            assertThat(DATA.receivedFor(route).get(0).header("X-User-Id")).isEqualTo(USER.toString());
        }
    }

    @Test
    void noSessionIsAnExplicitNullNotAnError() throws Exception {
        stubAll("null");
        MvcResult result = mockMvc.perform(auth(get("/screens/launch")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.session").value(nullValue()))
                .andReturn();
        assertKeys(result, "me", "memberships", "session");
    }

    @Test
    void requiredFragmentFailureFailsTheWholeScreen() throws Exception {
        stubAll(STATE);
        DATA.on(DATA_ME, request -> domainError(403, "SESSION_NOT_ACTIVE"));
        mockMvc.perform(auth(get("/screens/launch")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.data").doesNotExist());

        stubAll(STATE);
        DATA.on(DATA_CURRENT, request -> ok(""));
        mockMvc.perform(auth(get("/screens/launch")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    void rejectsSessionlessTokensAndUnknownQueryBeforeUpstream() throws Exception {
        mockMvc.perform(get("/screens/launch").header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/screens/launch")).andExpect(status().isUnauthorized());
        mockMvc.perform(auth(get("/screens/launch")).param("cursor", "x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("cursor"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    void nullMembershipsBodyIsAContractErrorNotAnEmptyList() throws Exception {
        // 소속 조회 실패를 미소속으로 바꾸지 않는다(policy 적용표 explore 행과 같은 규칙).
        DATA.on(DATA_ME, request -> ok(ME));
        DATA.on(DATA_CURRENT, request -> ok("{\"session\":null}"));
        DATA.on(DATA_MINE, request -> new MockUpstream.Response(200, "null"));
        mockMvc.perform(auth(get("/screens/launch"))).andExpect(status().isBadGateway());
    }
}
