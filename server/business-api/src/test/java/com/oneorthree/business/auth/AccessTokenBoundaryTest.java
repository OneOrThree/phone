package com.oneorthree.business.auth;

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
 * 이 서비스의 <b>보안 경계</b> 계약 — 실제 필터 체인으로 검증한다.
 *
 * <p>필터를 스텁으로 갈아 끼우면 검증 대상이 통째로 빠지므로, 진짜 서명한 JWT 로 진짜 필터를 통과시킨다.
 */
@DisplayName("AT 검증 경계와 X-User-Id 폐기")
class AccessTokenBoundaryTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID VICTIM = UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Test
    @DisplayName("토큰이 없으면 401 + UNAUTHORIZED 봉투 — 앱이 이 코드로 재로그인을 트리거한다")
    void 토큰없음() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/notification-settings"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("refresh 토큰은 서명이 맞아도 거절한다 — type 가드가 없으면 30일 토큰으로 위성 쓰기에 닿는다")
    void refresh토큰거절() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.refresh(USER)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        // 상류를 아예 부르지 않았는지도 본다 — 거절이 «필터에서» 끝나야 한다.
        assertThat(NOTI.received()).isEmpty();
    }

    @Test
    @DisplayName("type 클레임이 없는 구 토큰도 거절한다(fail-closed)")
    void type클레임없음() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.withoutTypeClaim(USER)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("만료된 AT 는 거절한다")
    void 만료토큰() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.expired(USER)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("exp 가 없는 AT 는 거절한다 — 파서는 통과시킨다(영구 유효 토큰이 된다)")
    void 만료클레임없음() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.withoutExpiration(USER)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        assertThat(NOTI.received()).isEmpty();
    }

    @Test
    @DisplayName("subject 가 없는 AT 는 401 이다 — 500 이면 NPE 가 필터 밖으로 샌 것이다")
    void subject없음() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.withoutSubject()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("과도하게 긴 Authorization 헤더는 파서에 넘기지 않는다")
    void 헤더길이상한() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + "a".repeat(9000)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("다른 키로 서명한 AT 는 거절한다")
    void 서명불일치() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.signedWithOtherKey(USER)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("외부 X-User-Id 위조는 폐기된다 — 상류에는 검증한 AT subject 만 나간다 (A22 ㉸)")
    void 유저헤더위조() throws Exception {
        NOTI.on("GET /internal/users/" + USER + "/notification-settings", request ->
                new MockUpstream.Response(200, """
                        {"notificationEnabled":true,"soundEnabled":true,"nightModeEnabled":false,
                         "nightStartTime":null,"nightEndTime":null}"""));

        mockMvc.perform(get("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        // 공격자가 남의 id 를 실어 보낸다.
                        .header("X-User-Id", VICTIM.toString()))
                .andExpect(status().isOk());

        // 위조한 id 로는 «경로조차» 만들어지지 않는다 — 상류가 받은 것은 AT subject 뿐이다.
        var requests = NOTI.received();
        assertThat(requests).hasSize(1);
        assertThat(requests.get(0).path()).contains(USER.toString());
        assertThat(requests.get(0).path()).doesNotContain(VICTIM.toString());
        assertThat(requests.get(0).header("X-User-Id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("매핑되지 않은 경로는 404 — 500 이면 라우팅 문제가 「서버 장애」로 보인다")
    void 미매핑경로는404() throws Exception {
        // 관리 엔드포인트는 포트 9091 로 격리돼 있다. 서비스 포트로 부르면 «없는 경로»이고,
        // 그건 격리가 정상 동작한 것이므로 500 이 아니라 404 여야 한다.
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ENDPOINT_NOT_FOUND"));
    }

    @Test
    @DisplayName("caller 별 서비스 토큰이 명시된 대상에만 간다 — 다른 상류의 토큰이 새지 않는다 (A22 ㊀)")
    void caller자격유출없음() throws Exception {
        stubActiveUser(USER);
        DATA.on("PUT /internal/users/" + USER + "/notification-settings-commands", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"33333333-3333-3333-3333-333333333333\","
                                + "\"eventId\":\"evt-1\",\"version\":7}"));
        NOTI.on("PUT /internal/users/" + USER + "/notification-settings",
                request -> new MockUpstream.Response(204, null));
        DATA.on("POST /internal/outbox-commands/33333333-3333-3333-3333-333333333333/delivered",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(put("/api/v1/users/me/notification-settings")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("""
                                {"notificationEnabled":false,"soundEnabled":true,
                                 "nightModeEnabled":true,"nightStartTime":"22:00","nightEndTime":"07:00"}"""))
                .andExpect(status().isNoContent());

        // Data 는 Data 토큰만, 알림은 알림 토큰만 본다. 토큰을 공유하면 수신 측이 호출자를 구분하지 못해
        // 허용목록이 합쳐지고 한쪽 유출이 다른 쪽 명령을 연다(A22 ㊀ · ㉱).
        assertThat(DATA.received()).isNotEmpty();
        assertThat(NOTI.received()).isNotEmpty();
        for (var request : DATA.received()) {
            assertThat(request.header("Authorization")).isEqualTo("Bearer ci-token-data");
        }
        for (var request : NOTI.received()) {
            assertThat(request.header("Authorization")).isEqualTo("Bearer ci-token-noti");
        }
        // 링크는 이 유스케이스에 끼지 않으므로 링크 토큰이 어디에도 나가지 않았다.
        assertThat(LINK.received()).isEmpty();
    }
}
