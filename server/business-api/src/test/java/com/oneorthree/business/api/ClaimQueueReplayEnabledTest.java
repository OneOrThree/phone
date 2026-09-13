package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 정지 창(재개 CLI 운영 기간)에는 {@code 202} 로 접는다 — 큐 커밋 뒤에만(계약 §4 · A22 ㊄ · ㊺). */
@DisplayName("claim 202 — 정지 창")
@TestPropertySource(properties = "business.compat.claim-queue-replay-enabled=true")
class ClaimQueueReplayEnabledTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-00000000000d");
    private static final String INTENT_ID = "bbbbbbbb-0000-0000-0000-00000000000d";

    @Test
    @DisplayName("내구 적재가 커밋된 뒤 동기 확정이 실패하면 202")
    void 정지창에서는202() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e\",\"version\":1,\"completed\":false}"));
        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isAccepted());
    }

    @Test
    @DisplayName("적재 자체가 실패하면 정지 창에도 202 를 주지 않는다 — 큐 커밋이 202 의 전제다")
    void 적재실패면202아님() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents",
                request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isServiceUnavailable());
    }
    @Test
    @DisplayName("종결된 같은 요청은 200으로 재생하고 새 키의 대기 의도만 202를 받는다")
    void completedRequestDoesNotPretendToQueueAgain() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request -> {
            boolean completed = "finished:claim-intent".equals(request.header("Idempotency-Key"));
            return new MockUpstream.Response(200, """
                    {"commandId":"%s","eventId":"e","version":1,"completed":%s}
                    """.formatted(INTENT_ID, completed));
        });
        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "finished")
                        .contentType("application/json").content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isOk());
        assertThat(LINK.received()).isEmpty();

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "new-attempt")
                        .contentType("application/json").content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isAccepted());
        assertThat(LINK.received()).isNotEmpty();
        assertThat(DATA.hits("POST /internal/invite-links/claim-confirmations")).isZero();
    }

}
