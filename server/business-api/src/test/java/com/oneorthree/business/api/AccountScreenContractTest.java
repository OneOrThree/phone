package com.oneorthree.business.api;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/account} — me(Data) · settings(Notification 정본, 순수 GET) 병렬.
 * settings 는 공개 {@code GET /me/settings} 모양({@code notifications} 하나)으로 투영한다(§4 각주).
 */
class AccountScreenContractTest extends ScreenContractTestBase {

    private static final String SETTINGS_PATH = USERS + "/notification-settings";
    private static final String NOTI_SETTINGS = "GET " + SETTINGS_PATH;
    private static final String SETTINGS = "{\"notificationEnabled\":false,\"soundEnabled\":true,"
            + "\"nightModeEnabled\":true,\"nightStartTime\":\"22:00\",\"nightEndTime\":\"07:00\"}";

    @Test
    void composesMeAndProjectedSettingsFromTwoServices() throws Exception {
        DATA.on(DATA_ME, request -> ok(ME));
        NOTI.on(NOTI_SETTINGS, request -> ok(SETTINGS));
        MvcResult result = mockMvc.perform(auth(get("/screens/account")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.me.name").value("수빈"))
                .andExpect(jsonPath("$.data.settings.notifications").value(false))
                .andExpect(jsonPath("$.data.settings.soundEnabled").doesNotExist())
                .andExpect(jsonPath("$.data.settings.notificationEnabled").doesNotExist())
                .andReturn();
        assertKeys(result, "me", "settings");
        assertThat(NOTI.receivedFor(NOTI_SETTINGS).get(0).header("X-User-Id")).isEqualTo(USER.toString());
        // 화면 조회는 쓰기가 아니다(B12) — 설정 초기화 POST 는 보내지 않는다.
        assertThat(NOTI.hits("POST " + SETTINGS_PATH + "/initialized")).isZero();
        assertThat(DATA.hits("GET " + USERS + "/notification-settings-snapshot")).isZero();
    }

    @Test
    void requiredFragmentFailureFailsTheWholeScreen() throws Exception {
        DATA.on(DATA_ME, request -> ok(ME));
        NOTI.on(NOTI_SETTINGS, request -> ok(""));
        mockMvc.perform(auth(get("/screens/account")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));

        DATA.on(DATA_ME, request -> domainError(403, "SESSION_NOT_ACTIVE"));
        NOTI.on(NOTI_SETTINGS, request -> ok(SETTINGS));
        mockMvc.perform(auth(get("/screens/account")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    @Test
    void acceptsNoQuery() throws Exception {
        mockMvc.perform(auth(get("/screens/account")).param("fields", "all"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        assertThat(DATA.received()).isEmpty();
        assertThat(NOTI.received()).isEmpty();
    }
}
