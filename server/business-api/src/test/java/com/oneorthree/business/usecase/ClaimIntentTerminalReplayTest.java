package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 종결된 claim 의도의 <b>재생</b>.
 *
 * <p>같은 {@code Idempotency-Key} 의 첫 요청이 {@code SLUG_NOT_FOUND} 로 실패하면 의도는
 * {@code ABANDONED} 로 종결된다. 응답이 유실돼 앱이 그대로 재시도하면 Data 는 「이미 끝났다」를
 * 돌려주는데, 그 값이 {@code completed} 불리언 하나면 <b>정상 확정·대상 없음</b>과 <b>터미널 오류</b>가
 * 구분되지 않는다 — 첫 요청은 404 인데 재시도는 200 이 되어 멱등 계약이 깨진다.
 *
 * <p>원장이 종결 코드를 보존하고 그것으로 원래 판정을 재생해야 한다.
 */
@DisplayName("종결된 claim 의도의 재생")
class ClaimIntentTerminalReplayTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID COMMAND = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final String SLUG = "dead-slug";

    @Autowired
    private InviteLinkUseCase useCase;

    private void stubIntent(boolean completed, String terminalCode) {
        DATA.on("POST /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + COMMAND + "\",\"eventId\":\"e1\",\"version\":1,"
                        + "\"completed\":" + completed + ",\"terminalCode\":"
                        + (terminalCode == null ? "null" : "\"" + terminalCode + "\"") + "}"));
    }

    private InviteLinkUseCase.ClaimOutcome claim() {
        return useCase.claim(USER, SLUG, RequestIdempotencyKeys.from("same-key"),
                Deadline.startingNow(Duration.ofSeconds(10)));
    }

    /** 첫 요청이 받은 404 를 재시도도 그대로 받아야 한다. */
    @Test
    @DisplayName("판정으로 종결된 의도는 그 판정을 재생한다 — 첫 요청 4xx, 재시도 200 이면 계약 위반이다")
    void aTerminallyAbandonedIntentReplaysItsOriginalJudgement() {
        stubActiveUser(USER);
        stubIntent(true, "SLUG_NOT_FOUND");

        assertThatThrownBy(this::claim)
                .isInstanceOf(UpstreamDomainException.class)
                .satisfies(thrown -> {
                    UpstreamDomainException e = (UpstreamDomainException) thrown;
                    assertThat(e.getCode()).isEqualTo("SLUG_NOT_FOUND");
                    assertThat(e.getStatus()).isEqualTo(404);
                    assertThat(e.getRetryAfterMs())
                            .as("종결 판정은 「나중에 다시」가 아니다 — 실으면 isTerminal 과 어긋난다")
                            .isNull();
                });
        // 재생이므로 상류를 다시 밟지 않는다.
        assertThat(LINK.hits("POST /internal/links/claim")).isZero();
    }

    /** 「붙일 대상 없음」으로 끝난 의도는 판정이 아니다 — 재시도도 그대로 200 이어야 한다. */
    @Test
    @DisplayName("정상 종결된 의도는 그대로 200 이다 — 코드가 없는 것이 둘을 가르는 값이다")
    void anIntentThatEndedWithoutAJudgementStillSucceeds() {
        stubActiveUser(USER);
        stubIntent(true, null);

        assertThat(claim().accepted()).isTrue();
        assertThat(LINK.hits("POST /internal/links/claim")).isZero();
    }
}
