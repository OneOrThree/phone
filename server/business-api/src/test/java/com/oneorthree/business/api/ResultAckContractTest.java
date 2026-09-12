package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 결과 ack 의 prepare → Data commit → noti commit 순서와 수렴 계약(A22 ⓓ · ㊅). */
@DisplayName("결과 ack 게이트 상태 흐름")
class ResultAckContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000003");
    private static final UUID SESSION = UUID.fromString("ffffffff-0000-0000-0000-000000000001");
    private static final UUID CLAIM_TOKEN = UUID.fromString("ffffffff-0000-0000-0000-000000000002");

    private String ackPath() {
        return "/api/v1/me/challenge-results/" + SESSION + "/ack";
    }

    @Test
    @DisplayName("정상: prepare → Data ack → commit 순서로 간다")
    void 정상순서() throws Exception {
        NOTI.on("POST /internal/users/" + USER + "/result-ack/prepare", request ->
                new MockUpstream.Response(200, "{\"held\":true,\"state\":\"HELD\"}"));
        DATA.on("POST /internal/users/" + USER + "/challenge-results/" + SESSION + "/ack",
                request -> new MockUpstream.Response(200, null));
        NOTI.on("POST /internal/users/" + USER + "/result-ack/commit",
                request -> new MockUpstream.Response(204, null));

        mockMvc.perform(post(ackPath())
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"claimToken\":\"" + CLAIM_TOKEN + "\"}"))
                .andExpect(status().isOk());

        assertThat(NOTI.received().get(0).methodAndPath())
                .isEqualTo("POST /internal/users/" + USER + "/result-ack/prepare");
        assertThat(DATA.received()).hasSize(1);
        assertThat(NOTI.received().get(1).methodAndPath())
                .isEqualTo("POST /internal/users/" + USER + "/result-ack/commit");
    }

    @Test
    @DisplayName("prepare 가 held=false 를 줘도 Data ack 는 진행한다 — 「이미 확정」일 수 있고 실패로 읽으면 확인이 막힌다")
    void heldFalse도진행() throws Exception {
        NOTI.on("POST /internal/users/" + USER + "/result-ack/prepare", request ->
                new MockUpstream.Response(200, "{\"held\":false,\"state\":\"COMMITTED\"}"));
        DATA.on("POST /internal/users/" + USER + "/challenge-results/" + SESSION + "/ack",
                request -> new MockUpstream.Response(200, null));
        NOTI.on("POST /internal/users/" + USER + "/result-ack/commit",
                request -> new MockUpstream.Response(204, null));

        mockMvc.perform(post(ackPath())
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"claimToken\":\"" + CLAIM_TOKEN + "\"}"))
                .andExpect(status().isOk());

        assertThat(DATA.hits("POST /internal/users/" + USER + "/challenge-results/" + SESSION + "/ack"))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("prepare 가 실패하면 Data ack 를 하지 않는다 — 억제 없이 커밋하면 대기 푸시가 그대로 나간다")
    void prepare실패면ack안함() throws Exception {
        NOTI.on("POST /internal/users/" + USER + "/result-ack/prepare",
                request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post(ackPath())
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"claimToken\":\"" + CLAIM_TOKEN + "\"}"))
                .andExpect(status().isServiceUnavailable());

        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("Data ack 가 실패하면 abort 를 보내고 그 실패를 올린다 — 성공한 척하지 않는다")
    void data실패면abort() throws Exception {
        NOTI.on("POST /internal/users/" + USER + "/result-ack/prepare", request ->
                new MockUpstream.Response(200, "{\"held\":true,\"state\":\"HELD\"}"));
        DATA.on("POST /internal/users/" + USER + "/challenge-results/" + SESSION + "/ack", request ->
                new MockUpstream.Response(409,
                        "{\"code\":\"RESULT_CLAIM_STALE\",\"message\":\"표시 선점이 만료됐어요\"}"));
        NOTI.on("POST /internal/users/" + USER + "/result-ack/abort",
                request -> new MockUpstream.Response(204, null));

        mockMvc.perform(post(ackPath())
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"claimToken\":\"" + CLAIM_TOKEN + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESULT_CLAIM_STALE"));

        assertThat(NOTI.hits("POST /internal/users/" + USER + "/result-ack/abort")).isEqualTo(1);
        assertThat(NOTI.hits("POST /internal/users/" + USER + "/result-ack/commit")).isZero();
    }

    @Test
    @DisplayName("abort 조차 실패해도 원래의 Data 실패를 올린다 — 해제는 NEEDS_CONFIRM 수렴에 맡긴다")
    void abort실패도원래실패() throws Exception {
        NOTI.on("POST /internal/users/" + USER + "/result-ack/prepare", request ->
                new MockUpstream.Response(200, "{\"held\":true,\"state\":\"HELD\"}"));
        DATA.on("POST /internal/users/" + USER + "/challenge-results/" + SESSION + "/ack", request ->
                new MockUpstream.Response(409,
                        "{\"code\":\"RESULT_ALREADY_ACKED\",\"message\":\"이미 확인한 결과예요\"}"));
        NOTI.on("POST /internal/users/" + USER + "/result-ack/abort",
                request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post(ackPath())
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"claimToken\":\"" + CLAIM_TOKEN + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESULT_ALREADY_ACKED"));
    }

    @Test
    @DisplayName("commit 이 실패해도 사용자 요청은 성공 — Data ack 는 이미 커밋됐고 NEEDS_CONFIRM 이 수렴한다")
    void commit실패는성공() throws Exception {
        NOTI.on("POST /internal/users/" + USER + "/result-ack/prepare", request ->
                new MockUpstream.Response(200, "{\"held\":true,\"state\":\"HELD\"}"));
        DATA.on("POST /internal/users/" + USER + "/challenge-results/" + SESSION + "/ack",
                request -> new MockUpstream.Response(200, null));
        NOTI.on("POST /internal/users/" + USER + "/result-ack/commit",
                request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post(ackPath())
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"claimToken\":\"" + CLAIM_TOKEN + "\"}"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("prepare 가 빈 본문으로 성공하면 Data ack 를 하지 않는다 — 빈 200/204 는 HELD 의 증거가 아니다")
    void prepare빈본문은ack안함() throws Exception {
        // 롤링 배포·프록시 오류가 만드는 모양이다. null 을 허용하면 tombstone 없이 ack 가 커밋돼,
        // 그 사이 도착한 BET_RESULT 가 이미 결과를 확인한 사용자에게 발송된다.
        NOTI.on("POST /internal/users/" + USER + "/result-ack/prepare",
                request -> new MockUpstream.Response(204, null));

        mockMvc.perform(post(ackPath())
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"claimToken\":\"" + CLAIM_TOKEN + "\"}"))
                .andExpect(status().isBadGateway());

        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("선점: RESULT_CLAIM_HELD 의 retryAfterMs 를 다시 계산하지 않고 그대로 중계한다")
    void retryAfter그대로중계() throws Exception {
        DATA.on("POST /internal/users/" + USER + "/challenge-results/" + SESSION + "/claim", request ->
                new MockUpstream.Response(409, """
                        {"code":"RESULT_CLAIM_HELD","message":"다른 기기에서 결과를 보고 있어요",
                         "retryAfterMs":4200}"""));

        mockMvc.perform(post("/api/v1/me/challenge-results/" + SESSION + "/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESULT_CLAIM_HELD"))
                // 값을 재계산하면 두 서버의 시계 차이가 섞인다.
                .andExpect(jsonPath("$.retryAfterMs").value(4200));
    }

    @Test
    @DisplayName("선점·ack 는 재시도하지 않는다 — 조건부 원자 UPDATE 라 두 번째 시도가 판정을 뒤집는다")
    void 비멱등명령은재시도금지() throws Exception {
        DATA.on("POST /internal/users/" + USER + "/challenge-results/" + SESSION + "/claim",
                request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post("/api/v1/me/challenge-results/" + SESSION + "/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isServiceUnavailable());

        // 5xx 인데도 «한 번만» 갔다. retryable=false 가 실제로 재시도를 막는지 확인한다.
        assertThat(DATA.hits("POST /internal/users/" + USER + "/challenge-results/" + SESSION + "/claim"))
                .isEqualTo(1);
    }
}
