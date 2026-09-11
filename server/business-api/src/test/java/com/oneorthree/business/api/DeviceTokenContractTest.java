package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 기기 토큰 등록·삭제의 순서 계약(A22 ㊲ · ㊿ · ㊨ · ㊪ · ㊍ · ⓖ). */
@DisplayName("기기 토큰 조합")
class DeviceTokenContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final String COMMAND_ID = "bbbbbbbb-0000-0000-0000-000000000001";

    @Test
    @DisplayName("삭제는 Data outbox 를 「먼저」 기록하고 그다음 직접 삭제한다 — 뒤집으면 둘 다 안 남는다")
    void 삭제순서() throws Exception {
        DATA.on("POST /internal/users/" + USER + "/device-token-deletions", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + COMMAND_ID + "\",\"eventId\":\"evt\",\"version\":3}"));
        NOTI.on("DELETE /internal/devices", request -> new MockUpstream.Response(204, null));
        DATA.on("POST /internal/outbox-commands/" + COMMAND_ID + "/delivered",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(delete("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.accessWithGeneration(USER, 5))
                        .header("X-Device-Token", "fcm-token-1")
                        .header("X-Device-Ownership", "own-1"))
                .andExpect(status().isNoContent());

        // 시간 순서: outbox 기록이 직접 삭제보다 앞에 있어야 한다.
        var all = DATA.received();
        assertThat(all.get(0).methodAndPath())
                .isEqualTo("POST /internal/users/" + USER + "/device-token-deletions");
        assertThat(NOTI.received()).hasSize(1);

        // 대상 토큰·소유권·세대가 outbox 봉투에 전부 실렸다 — 하나라도 빠지면 계약대로 못 만든다.
        assertThat(all.get(0).body()).contains("fcm-token-1", "own-1", "\"authGeneration\":5");

        // 삭제 요청은 본문이 없으므로 세 값이 헤더로 나간다(㊪ · ㊟).
        var deleteRequest = NOTI.received().get(0);
        assertThat(deleteRequest.header("X-Device-Token")).isEqualTo("fcm-token-1");
        assertThat(deleteRequest.header("X-Device-Ownership")).isEqualTo("own-1");
        assertThat(deleteRequest.header("X-Auth-Generation")).isEqualTo("5");
    }

    @Test
    @DisplayName("gen 없는 구 AT 은 X-Auth-Generation 헤더 자체를 붙이지 않는다 — 채우면 tombstone 우회 (A22 ㊍)")
    void 세대없는AT는헤더없음() throws Exception {
        DATA.on("POST /internal/users/" + USER + "/device-token-deletions", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + COMMAND_ID + "\",\"eventId\":\"evt\",\"version\":3}"));
        NOTI.on("DELETE /internal/devices", request -> new MockUpstream.Response(204, null));
        DATA.on("POST /internal/outbox-commands/" + COMMAND_ID + "/delivered",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(delete("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("X-Device-Token", "fcm-token-1"))
                .andExpect(status().isNoContent());

        // 「세대 없음」과 「세대 0」은 다르다 — 빈 값이나 0 이 아니라 헤더가 아예 없어야 한다.
        assertThat(NOTI.received().get(0).header("X-Auth-Generation")).isNull();
        // outbox 에도 null 로 실린다. Data 의 현재 세대로 채우지 않는다.
        assertThat(DATA.received().get(0).body()).contains("\"authGeneration\":null");
    }

    @Test
    @DisplayName("outbox 기록이 실패해도 직접 삭제는 시도한다 (A22 ㋩) — 둘 다 실패하면 503 으로 앱에 남긴다")
    void outbox실패에도직접삭제시도() throws Exception {
        DATA.on("POST /internal/users/" + USER + "/device-token-deletions",
                request -> new MockUpstream.Response(500, "{\"error\":\"down\"}"));
        NOTI.on("DELETE /internal/devices", request -> new MockUpstream.Response(204, null));

        mockMvc.perform(delete("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("X-Device-Token", "fcm-token-1"))
                .andExpect(status().isNoContent());

        // outbox 가 죽었어도 직접 삭제가 실제로 나갔다. 여기서 멈추면 이전 계정 푸시가 계속 간다.
        assertThat(NOTI.hits("DELETE /internal/devices")).isEqualTo(1);
    }

    @Test
    @DisplayName("outbox·직접 삭제 모두 실패하면 503 — 성공한 척하면 앱의 내구 재시도까지 사라진다")
    void 둘다실패면503() throws Exception {
        DATA.on("POST /internal/users/" + USER + "/device-token-deletions",
                request -> new MockUpstream.Response(500, "{}"));
        NOTI.on("DELETE /internal/devices", request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(delete("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("X-Device-Token", "fcm-token-1"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("UPSTREAM_UNAVAILABLE"));
    }

    @Test
    @DisplayName("비활성 사용자의 등록은 막는다 — 위성 직행 쓰기는 Data 활성 검사를 안 거친다 (A22 ⓖ)")
    void 비활성사용자등록차단() throws Exception {
        DATA.on("GET /internal/users/" + USER + "/activation",
                request -> new MockUpstream.Response(200, "{\"active\":false}"));

        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"deviceToken\":\"fcm-token-1\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("USER_INACTIVE"));

        // 알림 서버에는 아무것도 도달하지 않았다.
        assertThat(NOTI.received()).isEmpty();
    }

    @Test
    @DisplayName("활성 검사가 판정 불가면 503 — 「비활성」으로 접으면 Data 장애가 전원 차단이 된다")
    void 활성검사장애는503() throws Exception {
        DATA.on("GET /internal/users/" + USER + "/activation",
                request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"deviceToken\":\"fcm-token-1\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("UPSTREAM_UNAVAILABLE"));
    }

    @Test
    @DisplayName("deviceBootstrap 을 실으면 Data 에 세션을 동기 확인하고 sessionEpoch 를 봉투에 넣는다 (A22 ㋨)")
    void 세션확인과fencing() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/auth/device-sessions/verify", request ->
                new MockUpstream.Response(200, "{\"active\":true,\"sessionEpoch\":42}"));
        NOTI.on("POST /internal/devices",
                request -> new MockUpstream.Response(200, "{\"ownershipToken\":\"own-next\"}"));

        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.accessWithGeneration(USER, 9))
                        .contentType("application/json")
                        .content("""
                                {"deviceToken":"fcm-token-1","ownershipToken":"own-prev",
                                 "deviceBootstrap":"boot-1"}"""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownershipToken").value("own-next"));

        // 세 축의 값이 전부 등록 봉투에 실렸다 — 하나라도 빠지면 막을 수 없는 경합이 남는다(A22 ㋞).
        String body = NOTI.receivedFor("POST /internal/devices").get(0).body();
        assertThat(body).contains("fcm-token-1", "own-prev", "boot-1",
                "\"sessionEpoch\":42", "\"authGeneration\":9");
    }

    @Test
    @DisplayName("deviceBootstrap 세션이 이미 끝났으면 등록을 거절한다 — 지연 등록이 남의 기기 토큰을 되찾아간다")
    void 죽은세션등록거절() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/auth/device-sessions/verify", request ->
                new MockUpstream.Response(200, "{\"active\":false,\"sessionEpoch\":42}"));

        mockMvc.perform(put("/api/v1/users/me/device-token")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"deviceToken\":\"fcm-token-1\",\"deviceBootstrap\":\"boot-stale\"}"))
                .andExpect(status().isUnauthorized());

        assertThat(NOTI.received()).isEmpty();
    }
}
