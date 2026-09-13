package com.oneorthree.business.usecase;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.ValueSource;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import org.springframework.beans.factory.annotation.Autowired;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 일회성 재개 CLI — {@code 202} 를 준 claim 을 <b>누가 끝내는지</b>에 대한 답이다.
 *
 * <p>이 경로가 없으면 「큐만 저장하고 재생 주체 없이 202」라는 구멍이 그대로 남는다. Business 에는
 * 크론이 없고(§6) Data 는 링크를 relay 허용목록 밖으로 부를 수 없으므로(§3), 운영자가 실행하는
 * 이 CLI 가 유일한 재개 주체다.
 */
@DisplayName("claim 의도 재개 CLI")
class ClaimIntentReplayTest extends UpstreamTestBase {

    private static final String CMD_1 = "77777777-0000-0000-0000-000000000001";
    private static final String USER_1 = "88888888-0000-0000-0000-000000000001";
    private static final String CLAIM_1 = "99999999-0000-0000-0000-000000000001";

    @Autowired
    private ClaimIntentReplayService runner;

    private static final String LEASE_TOKEN = "66666666-0000-0000-0000-000000000001";

    static Stream<Arguments> negativePendingTotals() {
        return Stream.of(Arguments.of(-1L, false), Arguments.of(-1L, true),
                Arguments.of(Long.MIN_VALUE, false), Arguments.of(Long.MIN_VALUE, true));
    }

    @ParameterizedTest
    @MethodSource("negativePendingTotals")
    void negativePendingCountStopsTheCliBeforeLeasingOrCompletingAnyIntent(long pending, boolean hasItem) {
        String item = "{\"commandId\":\"" + CMD_1 + "\",\"userId\":\"" + USER_1
                + "\",\"slug\":\"abc123\",\"idempotencyKey\":\"original:claim-intent\",\"attempts\":0}";
        DATA.on("GET /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200,
                "{\"items\":[" + (hasItem ? item : "") + "],\"nextCursor\":null,\"pendingTotal\":" + pending + "}"));
        stubLeased(false);
        ClaimIntentReplayRunner cli = new ClaimIntentReplayRunner(runner);

        assertThatThrownBy(() -> cli.run(null)).isInstanceOf(UpstreamContractMismatchException.class);
        assertThat(DATA.received()).allMatch(request ->
                "GET /internal/invite-links/claim-intents".equals(request.methodAndPath()));
        assertThat(LINK.received()).isEmpty();

        DATA.on("GET /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200,
                "{\"items\":[],\"nextCursor\":null,\"pendingTotal\":0}"));
        cli.run(null);
        assertThat(runner.replayAll().gatePassed()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"items\":[]}", "{\"items\":[],\"pendingTotal\":null}",
            "{\"pendingTotal\":0}", "{\"items\":null,\"pendingTotal\":0}",
            "{\"items\":[],\"pendingTotal\":0.5}", "{\"items\":[],\"pendingTotal\":-0.5}",
            "{\"items\":[],\"pendingTotal\":9223372036854775808}",
            "{\"items\":[],\"pendingTotal\":\"0\"}", "{\"items\":[],\"pendingTotal\":false}"})
    void anIncompletePendingPageCannotPassTheZeroPendingGate(String body) {
        DATA.on("GET /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200, body));
        assertThatThrownBy(runner::replayAll).isInstanceOf(UpstreamContractMismatchException.class);
        assertThat(LINK.received()).isEmpty();
        DATA.on("GET /internal/invite-links/claim-intents",
                request -> new MockUpstream.Response(200, "{\"items\":[],\"pendingTotal\":0}"));
        assertThat(runner.replayAll().gatePassed()).isTrue();
    }

    static Stream<Arguments> absentPendingBodies() {
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"),
                Arguments.of(200, "{}"), Arguments.of(200, "{\"capability\":null}"),
                Arguments.of(200, "{\"claimId\":null}"),
                Arguments.of(200, "{\"claimId\":null,\"capability\":\"signed-value\"}"),
                Arguments.of(200, "{\"claimId\":null,\"capability\":\"\"}"),
                Arguments.of(200, "{\"claimId\":null,\"capability\":\"  \"}"),
                Arguments.of(200, "{\"claimId\":\"11111111-1111-4111-8111-111111111111\",\"capability\":null}"),
                Arguments.of(200, "{\"claimId\":\"11111111-1111-4111-8111-111111111111\",\"capability\":\"\"}"),
                Arguments.of(200, "{\"claimId\":\"11111111-1111-4111-8111-111111111111\",\"capability\":\"  \"}"));
    }

    @ParameterizedTest
    @MethodSource("absentPendingBodies")
    void absentPendingBodyCannotCompleteTheIntentAndTheNextRunCanConfirmIt(int responseStatus, String body) {
        AtomicBoolean completed = new AtomicBoolean();
        DATA.on("GET /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200,
                completed.get() ? "{\"items\":[],\"nextCursor\":null,\"pendingTotal\":0}"
                        : "{\"items\":[{\"commandId\":\"" + CMD_1 + "\",\"userId\":\"" + USER_1
                                + "\",\"slug\":\"abc123\",\"idempotencyKey\":\"original:claim-intent\","
                                + "\"attempts\":0}],\"nextCursor\":null,\"pendingTotal\":1}"));
        stubLeased(true);
        DATA.on("POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed", request -> {
            completed.set(true);
            return new MockUpstream.Response(200, null);
        });
        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(responseStatus, body));

        ClaimIntentReplayService.Result failed = runner.replayAll();
        assertThat(completed).isFalse();
        assertThat(failed.completed()).isZero();
        assertThat(failed.failed()).isEqualTo(1);
        assertThat(failed.pendingTotal()).isEqualTo(1);
        assertThat(failed.gatePassed()).isFalse();

        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(200,
                "{\"claimId\":\"" + CLAIM_1 + "\",\"capability\":\"cap-token\"}"));
        DATA.on("POST /internal/invite-links/claim-confirmations", request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\"confirmed\",\"version\":2}"));
        ClaimIntentReplayService.Result retried = runner.replayAll();
        assertThat(retried.completed()).isEqualTo(1);
        assertThat(retried.gatePassed()).isTrue();
        assertThat(DATA.hits("POST /internal/invite-links/claim-confirmations")).isEqualTo(1);
        assertThat(LINK.receivedFor("POST /internal/links/abc123/claim")).hasSize(2)
                .allSatisfy(request -> assertThat(request.header("Idempotency-Key")).isEqualTo("original:link-claim"));
    }

    static Stream<Arguments> incompleteConfirmationBodies() {
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"),
                Arguments.of(200, "{\"version\":2}"),
                Arguments.of(200, "{\"commandId\":\"" + CMD_1 + "\",\"version\":2}"),
                Arguments.of(200, "{\"commandId\":null,\"eventId\":\"confirmed\",\"version\":2}"),
                Arguments.of(200, "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\"\",\"version\":2}"),
                Arguments.of(200, "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\" \",\"version\":2}"),
                Arguments.of(200, "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\"confirmed\"}"),
                Arguments.of(200, "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\"confirmed\",\"version\":null}"),
                Arguments.of(200, "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\"confirmed\",\"version\":0}"),
                Arguments.of(200, "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\"confirmed\",\"version\":-1}"));
    }

    @ParameterizedTest
    @MethodSource("incompleteConfirmationBodies")
    void incompleteConfirmationCannotCompleteTheIntentAndTheNextRunCanRetry(int responseStatus, String body) {
        AtomicBoolean completed = new AtomicBoolean();
        DATA.on("GET /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200,
                completed.get() ? "{\"items\":[],\"nextCursor\":null,\"pendingTotal\":0}"
                        : "{\"items\":[{\"commandId\":\"" + CMD_1 + "\",\"userId\":\"" + USER_1
                                + "\",\"slug\":\"abc123\",\"idempotencyKey\":\"original:claim-intent\","
                                + "\"attempts\":0}],\"nextCursor\":null,\"pendingTotal\":1}"));
        stubLeased(true);
        String completePath = "POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed";
        String confirmPath = "POST /internal/invite-links/claim-confirmations";
        DATA.on(completePath, request -> {
            completed.set(true);
            return new MockUpstream.Response(200, null);
        });
        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(200,
                "{\"claimId\":\"" + CLAIM_1 + "\",\"capability\":\"cap-token\"}"));
        DATA.on(confirmPath, request -> new MockUpstream.Response(responseStatus, body));

        ClaimIntentReplayService.Result failed = runner.replayAll();
        assertThat(completed).isFalse();
        assertThat(DATA.hits(completePath)).isZero();
        assertThat(failed.completed()).isZero();
        assertThat(failed.failed()).isEqualTo(1);
        assertThat(failed.pendingTotal()).isEqualTo(1);
        assertThat(failed.gatePassed()).isFalse();

        // 응답 복구 후 같은 의도·같은 단계 키로 다시 확정한다. 실패를 완료 표시로 지우지 않았다.
        DATA.on(confirmPath, request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\"confirmed\",\"version\":2}"));
        ClaimIntentReplayService.Result retried = runner.replayAll();
        assertThat(retried.completed()).isEqualTo(1);
        assertThat(retried.failed()).isZero();
        assertThat(retried.pendingTotal()).isZero();
        assertThat(retried.gatePassed()).isTrue();
        assertThat(DATA.hits(completePath)).isEqualTo(1);
        assertThat(DATA.receivedFor(confirmPath)).hasSize(2).allSatisfy(request ->
                assertThat(request.header("Idempotency-Key")).isEqualTo("original:claim-confirm"));
        assertThat(DATA.receivedFor(confirmPath).get(0).body())
                .isEqualTo(DATA.receivedFor(confirmPath).get(1).body());
    }

    /**
     * 첫 조회는 의도 1건 + pendingTotal 1, 그다음부터는 빈 목록 + pendingTotal 0 을 준다 —
     * 완료 후 재순회가 끝나도록. gate 는 pendingTotal 로 판정하므로 그 값이 핵심이다.
     */
    private void stubPending(String key, String slug, int attempts) {
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        DATA.on("GET /internal/invite-links/claim-intents", request -> {
            if (calls.getAndIncrement() == 0) {
                return new MockUpstream.Response(200,
                        "{\"items\":[{\"commandId\":\"" + CMD_1 + "\",\"userId\":\"" + USER_1
                                + "\",\"slug\":\"" + slug + "\",\"idempotencyKey\":" + key
                                + ",\"attempts\":" + attempts + "}],\"nextCursor\":null,\"pendingTotal\":1}");
            }
            return new MockUpstream.Response(200, "{\"items\":[],\"nextCursor\":null,\"pendingTotal\":0}");
        });
    }

    private void stubLeased(boolean leased) {
        String body = leased
                ? "{\"leased\":true,\"leaseToken\":\"" + LEASE_TOKEN + "\"}"
                : "{\"leased\":false,\"leaseToken\":null}";
        DATA.on("POST /internal/invite-links/claim-intents/" + CMD_1 + "/lease",
                request -> new MockUpstream.Response(200, body));
    }

    private void stubCompleted() {
        DATA.on("POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed",
                request -> new MockUpstream.Response(200, null));
    }

    @Test
    @DisplayName("원래 Idempotency-Key 로 재생한다 — 새 키를 만들면 클릭을 하나 더 소진한다 (A22 ㉼)")
    void 원래키로재생() {
        // Data 가 저장한 값은 원 요청이 «적재 단계»에 쓴 키다 — base 가 아니라 base:claim-intent 다
        // (InviteLinkUseCase 가 그 파생 키로 적재를 부른다). 여기에 base 만 넣으면 실물과 다른
        // 픽스처가 되어, 접미가 두 번 붙는 결함을 테스트가 못 본다.
        stubPending("\"orig-key-1:claim-intent\"", "abc123", 1);
        stubLeased(true);
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(200,
                        "{\"claimId\":\"" + CLAIM_1 + "\",\"capability\":\"cap\",\"groupId\":null}"));
        DATA.on("POST /internal/invite-links/claim-confirmations", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\"e\",\"version\":5}"));
        stubCompleted();

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.completed()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        // 링크에 간 키가 «원 시도와 같은» 파생 키다 — 저장값을 base 로 삼으면 여기가
        // orig-key-1:claim-intent:link-claim 이 되어 원 시도의 키와 달라진다.
        assertThat(LINK.receivedFor("POST /internal/links/abc123/claim").get(0).header("Idempotency-Key"))
                .isEqualTo("orig-key-1:link-claim");
        assertThat(DATA.receivedFor("POST /internal/invite-links/claim-confirmations").get(0)
                .header("Idempotency-Key")).isEqualTo("orig-key-1:claim-confirm");
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed"))
                .isEqualTo(1);
        // 완료 표시가 leaseToken 으로 CAS 된다 — 없으면 만료 뒤 깨어난 옛 작업자가 새 임대의 작업을 뺀다.
        assertThat(DATA.receivedFor("POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed")
                .get(0).body()).contains(LEASE_TOKEN);
        assertThat(result.gatePassed()).isTrue();
    }

    @Test
    @DisplayName("lease 에 leaseToken 이 없으면 완료 표시하지 않는다 — CAS 없이 빼면 확정 안 된 claim 이 사라진다")
    void 토큰없는lease는완료금지() {
        stubPending("\"k\"", "abc123", 1);
        DATA.on("POST /internal/invite-links/claim-intents/" + CMD_1 + "/lease",
                request -> new MockUpstream.Response(200, "{\"leased\":true,\"leaseToken\":null}"));

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.failed()).isEqualTo(1);
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed")).isZero();
        assertThat(LINK.received()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(longs = {3, Long.MAX_VALUE})
    @DisplayName("빈 페이지라도 pendingTotal 이 남으면 gate 를 통과하지 못한다 — 「빈 페이지 = 전부 완료」가 아니다")
    void 빈페이지는완료아님(long pendingTotal) {
        // 지금 집을 것은 없지만(다른 작업자 lease·재시도 예정) 전체 미완료는 3건이다.
        DATA.on("GET /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"items\":[],\"nextCursor\":null,\"pendingTotal\":" + pendingTotal + "}"));

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.failed()).isZero();
        assertThat(result.pendingTotal()).isEqualTo(pendingTotal);
        assertThat(result.gatePassed()).isFalse();

        // CLI 는 그 상태를 «성공» 으로 끝내지 않는다.
        ClaimIntentReplayRunner cli = new ClaimIntentReplayRunner(runner);
        assertThatThrownBy(() -> cli.run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("미완료 claim 의도 " + pendingTotal + "건");
    }

    @Test
    @DisplayName("키가 비어 오면 재생하지 않고 실패로 센다 — 재생하면 클릭을 중복 소진한다")
    void 키없으면재생금지() {
        stubPending("null", "abc123", 1);

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.failed()).isEqualTo(1);
        assertThat(result.completed()).isZero();
        // 링크를 아예 부르지 않았다.
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    @DisplayName("lease 를 못 잡으면 건너뜀이지 실패가 아니다 — 다음 실행이 집는다")
    void lease실패는건너뜀() {
        stubPending("\"k\"", "abc123", 1);
        stubLeased(false);

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.skipped()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    @DisplayName("claimId=null(셀프초대·붙일 클릭 없음)도 완료 표시한다 — 안 하면 그 한 건이 gate 를 영구히 막는다")
    void 붙일대상없어도완료() {
        stubPending("\"k\"", "abc123", 1);
        stubLeased(true);
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(200, "{\"claimId\":null,\"capability\":null,\"groupId\":null}"));
        stubCompleted();

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.completed()).isEqualTo(1);
        // 확정을 부르지 않았다 — null claimId 로 부르면 Data 가 거절한다.
        assertThat(DATA.hits("POST /internal/invite-links/claim-confirmations")).isZero();
    }

    @Test
    @DisplayName("확정까지 끝냈어도 완료 표시가 낡은 리스로 거절되면 실패다 — gate 를 통과시키지 않는다")
    void 확정후완료표시가펜싱에막히면실패() {
        stubPending("\"k\"", "abc123", 1);
        stubLeased(true);
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(200,
                        "{\"claimId\":\"" + CLAIM_1 + "\",\"capability\":\"cap\",\"groupId\":null}"));
        DATA.on("POST /internal/invite-links/claim-confirmations", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + CMD_1 + "\",\"eventId\":\"e\",\"version\":5}"));
        // 리스가 만료돼 남이 재선점한 뒤다 — Data 가 이 보고를 받아 주면 새 소유자의 작업이 큐에서 빠진다.
        DATA.on("POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed", request ->
                new MockUpstream.Response(409,
                        "{\"code\":\"CLAIM_INTENT_LEASE_STALE\",\"message\":\"초대 대기 항목의 선점이 만료됐습니다.\"}"));

        ClaimIntentReplayService.Result result = runner.replayAll();

        // 「확정은 됐으니 성공」으로 접지 않는다 — 이 의도를 닫은 것은 우리가 아니므로 판정은 미완료다.
        assertThat(result.completed()).isZero();
        assertThat(result.failed()).isEqualTo(1);
        assertThat(result.gatePassed()).isFalse();
    }

    @Test
    @DisplayName("상류 도메인 판정(SLUG_NOT_FOUND)은 완료로 종결한다 — 재시도해도 답이 같다")
    void 판정은종결() {
        stubPending("\"k\"", "gone", 3);
        stubLeased(true);
        LINK.on("POST /internal/links/gone/claim", request ->
                new MockUpstream.Response(404,
                        "{\"code\":\"SLUG_NOT_FOUND\",\"message\":\"초대 링크를 찾을 수 없습니다.\"}"));
        stubCompleted();

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.completed()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        assertThat(DATA.receivedFor("POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed")
                .get(0).body()).contains("\"terminalCode\":\"SLUG_NOT_FOUND\"");
    }

    @Test
    @DisplayName("USER_WITHDRAWN(410)도 완료로 종결한다 — 탈퇴 익명화는 되돌릴 수 없다")
    void 탈퇴판정은종결() {
        stubPending("\"k\"", "abc123", 2);
        stubLeased(true);
        // link/src/lib/ledger.ts:24 — claim 하는 사람이나 초대자가 탈퇴했다.
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(410,
                        "{\"code\":\"USER_WITHDRAWN\",\"message\":\"USER_WITHDRAWN\"}"));
        stubCompleted();

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.completed()).isEqualTo(1);
        assertThat(result.failed()).isZero();
    }

    @Test
    @DisplayName("코드가 실린 403 은 «완료 표시하지 않는다» — 접으면 아무것도 claim 안 하고 gate 가 통과한다")
    void 배선거절은완료표시금지() {
        stubPending("\"k\"", "abc123", 1);
        stubLeased(true);
        stubCompleted();
        // ⚠️ 링크 서버는 «모든» 실패 본문에 code 를 싣는다(link/src/lib/errors.ts respond). 403 은
        //    인증 챌린지가 없어 본문이 살아 오므로, 경로 허용목록 배선 사고(link/src/lib/auth.ts:60)가
        //    UpstreamCredentialRejectedException 이 아니라 «도메인 판정»으로 들어온다.
        //    예전처럼 「판정 = 종결」로 접으면 이 한 번의 잘못된 배포로 큐 전체가 «완료» 표시되어
        //    사라지고, CLI 는 「미완료 0」이라고 보고한다 — 되돌릴 수 없는 유실이다.
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(403,
                        "{\"code\":\"SERVICE_ROUTE_FORBIDDEN\",\"message\":\"SERVICE_ROUTE_FORBIDDEN\"}"));

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.failed()).isEqualTo(1);
        assertThat(result.completed()).isZero();
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed")).isZero();
        assertThat(result.gatePassed()).isFalse();
    }

    @Test
    @DisplayName("판정 불가는 완료 표시하지 않고 실패로 센다 — lease 만료로 다음 실행이 집는다")
    void 판정불가는미완료() {
        stubPending("\"k\"", "abc123", 1);
        stubLeased(true);
        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(500, "{}"));

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.failed()).isEqualTo(1);
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + CMD_1 + "/completed")).isZero();
    }

    @Test
    @DisplayName("실패가 남으면 CLI 가 비정상 종료한다 — 삼키면 「미완료 0」 gate 가 거짓으로 통과한다")
    void 실패남으면비정상종료() {
        stubPending("null", "abc123", 1);

        // 러너는 «실행 시점»만 정하는 껍데기다. 컨텍스트에 빈으로 두면 테스트가 뜨는 순간 재개가
        // 돌아 버리므로(상류 스텁 전이라 컨텍스트 로딩이 실패한다) 여기서 직접 조립해 부른다.
        ClaimIntentReplayRunner cli = new ClaimIntentReplayRunner(runner);
        assertThatThrownBy(() -> cli.run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("재개하지 못한");
    }

    @Test
    void aConcurrentCompletionCanLeaveItemsWithAZeroCount() {
        DATA.on("GET /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200,
                "{\"items\":[{\"commandId\":\"" + CMD_1 + "\",\"userId\":\"" + USER_1
                        + "\",\"slug\":\"abc123\",\"idempotencyKey\":\"original:claim-intent\",\"attempts\":0}],"
                        + "\"nextCursor\":null,\"pendingTotal\":0}"));
        stubLeased(false);
        ClaimIntentReplayService.Result result = runner.replayAll();
        assertThat(result.skipped()).isEqualTo(1);
        assertThat(result.pendingTotal()).isZero();
        assertThat(result.gatePassed()).isTrue();
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    @DisplayName("전체 미완료 0 이면 gate 를 통과한다")
    void 빈큐() {
        DATA.on("GET /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200, "{\"items\":[],\"nextCursor\":null,\"pendingTotal\":0}"));

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.seen()).isZero();
        assertThat(result.completed()).isZero();
        assertThat(result.failed()).isZero();
        assertThat(result.gatePassed()).isTrue();
    }

    @Test
    @DisplayName("다른 작업자가 전부 lease 를 쥐고 있으면 건너뜀이고 gate 는 막힌다 — 진행 없으면 순회를 멈춘다")
    void 전부다른lease면gate막힘() {
        DATA.on("GET /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"items\":[{\"commandId\":\"" + CMD_1 + "\",\"userId\":\"" + USER_1
                                + "\",\"slug\":\"abc123\",\"idempotencyKey\":\"k\",\"attempts\":1}],"
                                + "\"nextCursor\":null,\"pendingTotal\":1}"));
        stubLeased(false);

        ClaimIntentReplayService.Result result = runner.replayAll();

        assertThat(result.skipped()).isEqualTo(1);
        assertThat(result.failed()).isZero();
        assertThat(result.gatePassed()).isFalse();
        // 진행이 없으므로 무한 순회하지 않는다.
        assertThat(DATA.hits("GET /internal/invite-links/claim-intents")).isEqualTo(1);
    }
}
