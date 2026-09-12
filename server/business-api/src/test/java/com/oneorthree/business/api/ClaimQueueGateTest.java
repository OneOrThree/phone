package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * <b>{@code 202} 는 재개 주체가 있을 때만 준다.</b>
 *
 * <p>{@code 202} 는 「나중에 누가 끝낸다」는 약속인데, 재개 CLI 가 돌지 않는 평상시에는 큐를 비울
 * 주체가 없다 — Business 에 크론이 없고(§6) Data 는 링크를 relay 허용목록 밖으로 부를 수 없다(§3).
 * 그때 202 를 주면 <b>큐만 쌓이고 아무도 끝내지 않는 영구 대기</b>가 되고, 앱은 그 응답을 성공으로
 * 보고 다음 로그인까지 재시도하지 않는다.
 */
@DisplayName("claim 202 는 재개 주체가 있을 때만")
@TestPropertySource(properties = "business.compat.claim-queue-replay-enabled=false")
class ClaimQueueGateTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-00000000000c");
    private static final String INTENT_ID = "bbbbbbbb-0000-0000-0000-00000000000c";

    @Test
    @DisplayName("재개 CLI 가 꺼진 평상시에는 202 가 아니라 실패를 올린다 — 앱의 내구 재시도에 맡긴다")
    void 재개주체없으면202금지() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e\",\"version\":1,\"completed\":false}"));
        // 링크가 판정을 못 내린다.
        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                // 202 가 아니다. 성공으로 응답하면 아무도 그 큐를 비우지 않는다.
                .andExpect(status().isServiceUnavailable());
    }
}
