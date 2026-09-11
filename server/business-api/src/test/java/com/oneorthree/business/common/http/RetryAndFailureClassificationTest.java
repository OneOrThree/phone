package com.oneorthree.business.common.http;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 공통 RestClient 팩토리의 계약 — 재시도 대상 · 멱등 키 유지 · 실패 분류(§4 · A22 ㉼).
 */
@DisplayName("재시도·멱등·실패 분류")
class RetryAndFailureClassificationTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000004");

    private static final String SETTINGS_BODY = """
            {"notificationEnabled":true,"soundEnabled":true,"nightModeEnabled":false,
             "nightStartTime":null,"nightEndTime":null}""";

    @Test
    @DisplayName("멱등 GET 은 5xx 에서 재시도한다")
    void GET재시도() throws Exception {
        NOTI.failThenSucceed("GET /internal/users/" + USER + "/notification-settings", 1, 500, SETTINGS_BODY);

        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isOk());

        assertThat(NOTI.hits("GET /internal/users/" + USER + "/notification-settings")).isEqualTo(2);
    }

    @Test
    @DisplayName("재시도에서 같은 Idempotency-Key 를 유지한다 — 새 키를 만들면 재시도가 중복 명령이 된다 (A22 ㉼)")
    void 재시도에멱등키유지() throws Exception {
        stubActiveUser(USER);
        DATA.failThenSucceed("PUT /internal/users/" + USER + "/notification-settings-commands", 1, 503,
                "{\"commandId\":\"11111111-1111-1111-1111-111111111199\",\"eventId\":\"e\",\"version\":2}");
        NOTI.on("PUT /internal/users/" + USER + "/notification-settings",
                request -> new MockUpstream.Response(204, null));
        DATA.on("POST /internal/outbox-commands/11111111-1111-1111-1111-111111111199/delivered",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        // 앱이 키를 소유한다 — 그 값이 그대로 쓰여야 한다.
                        .header("Idempotency-Key", "app-key-7")
                        .contentType("application/json")
                        .content(SETTINGS_BODY))
                .andExpect(status().isNoContent());

        var attempts = DATA.receivedFor("PUT /internal/users/" + USER + "/notification-settings-commands");
        assertThat(attempts).hasSize(2);
        // 두 시도가 같은 키다. 다르면 Data 의 UNIQUE 멱등 저장이 두 개의 서로 다른 명령을 만든다.
        assertThat(attempts.get(0).header("Idempotency-Key"))
                .isEqualTo(attempts.get(1).header("Idempotency-Key"));
        // 앱 키에서 파생됐고, 단계 접미가 붙어 상류끼리 키가 섞이지 않는다.
        assertThat(attempts.get(0).header("Idempotency-Key")).startsWith("app-key-7:");
    }

    @Test
    @DisplayName("한 요청이 여러 상류를 부를 때 단계별로 키가 다르다 — 같은 키면 두 저장소가 다른 명령을 같게 본다")
    void 단계별파생키() throws Exception {
        stubActiveUser(USER);
        DATA.on("PUT /internal/users/" + USER + "/notification-settings-commands", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"11111111-1111-1111-1111-111111111198\",\"eventId\":\"e\",\"version\":2}"));
        NOTI.on("PUT /internal/users/" + USER + "/notification-settings",
                request -> new MockUpstream.Response(204, null));
        DATA.on("POST /internal/outbox-commands/11111111-1111-1111-1111-111111111198/delivered",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "app-key-8")
                        .contentType("application/json")
                        .content(SETTINGS_BODY))
                .andExpect(status().isNoContent());

        String dataKey = DATA.receivedFor("PUT /internal/users/" + USER + "/notification-settings-commands")
                .get(0).header("Idempotency-Key");
        String notiKey = NOTI.receivedFor("PUT /internal/users/" + USER + "/notification-settings")
                .get(0).header("Idempotency-Key");
        assertThat(dataKey).isNotEqualTo(notiKey);
        assertThat(dataKey).startsWith("app-key-8:");
        assertThat(notiKey).startsWith("app-key-8:");
    }

    @Test
    @DisplayName("도메인 코드가 실린 4xx 는 그대로 중계한다 — 재해석하면 앱 분기가 조용히 빠진다")
    void 도메인코드중계() throws Exception {
        NOTI.on("GET /internal/users/" + USER + "/notification-settings", request ->
                new MockUpstream.Response(409,
                        "{\"code\":\"SETTINGS_VERSION_STALE\",\"message\":\"더 새 설정이 있어요\"}"));

        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SETTINGS_VERSION_STALE"));
    }

    @Test
    @DisplayName("코드 없는 401 은 «우리» 서비스 자격 문제라 502 — 사용자에게 401 을 주면 정상 세션이 전부 재로그인으로 튄다")
    void 자격거절은502() throws Exception {
        NOTI.on("GET /internal/users/" + USER + "/notification-settings",
                request -> new MockUpstream.Response(401, "{\"error\":\"bad token\"}"));

        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CREDENTIAL_REJECTED"));
    }

    @Test
    @DisplayName("코드 없는 404 는 계약 어긋남이라 502 — 400 으로 접으면 배선 사고가 「잘못된 요청」으로 숨는다")
    void 계약불일치는502() throws Exception {
        // 아무 핸들러도 등록하지 않으면 mock 이 코드 없는 404 를 준다 = 「없는 표면을 불렀다」.
        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
    }

    @Test
    @DisplayName("5xx 는 판정 불가라 503 — 재시도를 다 쓴 뒤에도 「아니오」로 접지 않는다")
    void 판정불가는503() throws Exception {
        NOTI.on("GET /internal/users/" + USER + "/notification-settings",
                request -> new MockUpstream.Response(502, "{}"));

        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("UPSTREAM_UNAVAILABLE"));

        assertThat(NOTI.hits("GET /internal/users/" + USER + "/notification-settings")).isEqualTo(2);
    }

    @Test
    @DisplayName("설정 갱신은 Data 내구 명령이 먼저 — 그 version 이 알림에 실려 역순 적용을 막는다 (A22 ㋕)")
    void 설정순서와version() throws Exception {
        stubActiveUser(USER);
        DATA.on("PUT /internal/users/" + USER + "/notification-settings-commands", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"11111111-1111-1111-1111-111111111197\",\"eventId\":\"e\",\"version\":19}"));
        NOTI.on("PUT /internal/users/" + USER + "/notification-settings",
                request -> new MockUpstream.Response(204, null));
        DATA.on("POST /internal/outbox-commands/11111111-1111-1111-1111-111111111197/delivered",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content(SETTINGS_BODY))
                .andExpect(status().isNoContent());

        // Data 기록이 알림 전달보다 먼저다.
        assertThat(DATA.received().get(1).methodAndPath())
                .isEqualTo("PUT /internal/users/" + USER + "/notification-settings-commands");
        // 그 version 이 알림 요청에 실렸다.
        assertThat(NOTI.receivedFor("PUT /internal/users/" + USER + "/notification-settings").get(0).query())
                .contains("version=19");
    }

    @Test
    @DisplayName("알림 전달이 실패하면 사용자 요청도 실패다 — 성공으로 응답하면 앱이 다음 변경까지 재시도하지 않는다")
    void 알림전달실패는요청실패() throws Exception {
        stubActiveUser(USER);
        DATA.on("PUT /internal/users/" + USER + "/notification-settings-commands", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"11111111-1111-1111-1111-111111111196\",\"eventId\":\"e\",\"version\":1}"));
        NOTI.on("PUT /internal/users/" + USER + "/notification-settings",
                request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content(SETTINGS_BODY))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    @DisplayName("설정 5필드는 필수 — 빠지면 400 (전체 교체 계약을 보존한다)")
    void 설정필수필드() throws Exception {
        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"notificationEnabled\":true}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    @DisplayName("야간 시각은 HH:mm 만 받는다 — 기존 제약 그대로")
    void 시각형식제약() throws Exception {
        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("""
                                {"notificationEnabled":true,"soundEnabled":true,"nightModeEnabled":true,
                                 "nightStartTime":"25:00","nightEndTime":"07:00"}"""))
                .andExpect(status().isBadRequest());
    }
}
