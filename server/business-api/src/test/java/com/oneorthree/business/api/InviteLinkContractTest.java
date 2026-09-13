package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 초대 링크 발급·claim 조합 계약. 기존 URI·성공상태·오류코드 보존이 핵심이다. */
@DisplayName("초대 링크 조합")
class InviteLinkContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
    private static final UUID GROUP = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID INVITER = USER;
    private static final String INTENT_ID = "dddddddd-0000-0000-0000-000000000001";
    private static final String CONFIRM_ID = "dddddddd-0000-0000-0000-000000000002";
    private static final String CLAIM_ID = "eeeeeeee-0000-0000-0000-000000000001";

    static Stream<Arguments> mismatchedIssueSubjects() {
        return Stream.of(Arguments.of(null, USER), Arguments.of(GROUP, null),
                Arguments.of(USER, USER), Arguments.of(GROUP, GROUP));
    }

    static Stream<Arguments> absentIssueContexts() {
        String complete = issueContext(true, true);
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"),
                Arguments.of(200, complete.replace("\"groupActive\":true,", "")),
                Arguments.of(200, complete.replace("\"inviterActiveMember\":true,", "")),
                Arguments.of(200, complete.replace("\"groupActive\":true", "\"groupActive\":null")),
                Arguments.of(200, complete.replace("\"inviterActiveMember\":true", "\"inviterActiveMember\":null")),
                Arguments.of(200, complete.replace("\"groupActive\":true,", "")
                        .replace("\"inviterActiveMember\":true,", "")));
    }

    @ParameterizedTest
    @MethodSource("absentIssueContexts")
    void absentIssueContextIsAContractErrorAndCanRetry(int code, String body) throws Exception {
        stubActiveUser(USER);
        String context = "GET /internal/groups/" + GROUP + "/invite-issue-context";
        DATA.on(context, request -> new MockUpstream.Response(code, body));
        LINK.on("POST /internal/links", request -> new MockUpstream.Response(200,
                "{\"slug\":\"abc123\",\"url\":\"https://l/abc123\"}"));
        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "same-issue"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(LINK.received()).isEmpty();
        DATA.on(context, request -> new MockUpstream.Response(200, issueContext(true, true)));
        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "same-issue"))
                .andExpect(status().isOk());
        assertThat(LINK.hits("POST /internal/links")).isEqualTo(1);
    }

    @ParameterizedTest
    @MethodSource("mismatchedIssueSubjects")
    void issueContextMustBelongToTheRequestedGroupAndAuthenticatedUser(UUID group, UUID inviter) throws Exception {
        stubActiveUser(USER);
        String invalid = issueContext(true, true)
                .replace("\"groupId\":\"" + GROUP + "\"", "\"groupId\":" + (group == null ? "null" : "\"" + group + "\""))
                .replace("\"inviterId\":\"" + USER + "\"", "\"inviterId\":" + (inviter == null ? "null" : "\"" + inviter + "\""));
        String context = "GET /internal/groups/" + GROUP + "/invite-issue-context";
        DATA.on(context, request -> new MockUpstream.Response(200, invalid));
        LINK.on("POST /internal/links", request -> new MockUpstream.Response(200,
                "{\"slug\":\"abc123\",\"url\":\"https://l/abc123\"}"));
        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "same-issue"))
                .andExpect(status().isBadGateway());
        assertThat(LINK.received()).isEmpty();
        DATA.on(context, request -> new MockUpstream.Response(200, issueContext(true, true)));
        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "same-issue"))
                .andExpect(status().isOk());
        assertThat(LINK.hits("POST /internal/links")).isEqualTo(1);
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

    static Stream<Arguments> incompleteIssuedLinks() {
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"),
                Arguments.of(200, "{}"), Arguments.of(200, "{\"slug\":null,\"url\":null}"),
                Arguments.of(200, "{\"slug\":\"abc123\"}"),
                Arguments.of(200, "{\"url\":\"https://l/abc123\"}"),
                Arguments.of(200, "{\"slug\":\"\",\"url\":\"https://l/abc123\"}"),
                Arguments.of(200, "{\"slug\":\"  \",\"url\":\"https://l/abc123\"}"),
                Arguments.of(200, "{\"slug\":\"abc123\",\"url\":\"\"}"),
                Arguments.of(200, "{\"slug\":\"abc123\",\"url\":\"  \"}"));
    }

    @ParameterizedTest
    @MethodSource("incompleteIssuedLinks")
    void incompleteIssuedLinkCannotBeSharedAndCanRetry(int responseStatus, String body) throws Exception {
        stubActiveUser(USER);
        DATA.on("GET /internal/groups/" + GROUP + "/invite-issue-context",
                request -> new MockUpstream.Response(200, issueContext(true, true)));
        LINK.on("POST /internal/links", request -> new MockUpstream.Response(responseStatus, body));
        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "retry-issue"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        String url = "https://l/abc123?g=" + GROUP;
        LINK.on("POST /internal/links", request -> new MockUpstream.Response(200,
                "{\"slug\":\"abc123\",\"url\":\"" + url + "\"}"));
        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "retry-issue"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("abc123"))
                .andExpect(jsonPath("$.url").value(url));
        assertThat(LINK.receivedFor("POST /internal/links")).hasSize(2).satisfies(requests -> {
            assertThat(requests.get(0).header("Idempotency-Key"))
                    .isEqualTo(requests.get(1).header("Idempotency-Key"));
            assertThat(requests.get(0).body()).isEqualTo(requests.get(1).body());
        });
    }

    static Stream<Arguments> absentConfirmBodies() {
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"),
                Arguments.of(200, "{\"version\":2}"),
                Arguments.of(200, "{\"commandId\":\"" + CONFIRM_ID + "\",\"version\":2}"),
                Arguments.of(200, "{\"commandId\":\"" + CONFIRM_ID + "\",\"eventId\":\"  \",\"version\":2}"),
                Arguments.of(200, "{\"commandId\":\"" + CONFIRM_ID + "\",\"eventId\":\"confirmed\"}"),
                Arguments.of(200, "{\"commandId\":\"" + CONFIRM_ID + "\",\"eventId\":\"confirmed\",\"version\":null}"),
                Arguments.of(200, "{\"commandId\":\"" + CONFIRM_ID + "\",\"eventId\":\"confirmed\",\"version\":0}"),
                Arguments.of(200, "{\"commandId\":\"" + CONFIRM_ID + "\",\"eventId\":\"confirmed\",\"version\":-1}"));
    }

    static Stream<Arguments> incompleteIntentBodies() {
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"),
                Arguments.of(200, "{\"version\":1,\"completed\":false}"),
                Arguments.of(200, "{\"version\":1,\"completed\":true}"),
                Arguments.of(200, "{\"commandId\":\"" + INTENT_ID + "\",\"version\":1,\"completed\":false}"),
                Arguments.of(200, "{\"commandId\":\"" + INTENT_ID
                        + "\",\"eventId\":\"  \",\"version\":1,\"completed\":false}"),
                Arguments.of(200, "{\"commandId\":\"" + INTENT_ID
                        + "\",\"eventId\":\"intent\",\"version\":0,\"completed\":false}"),
                Arguments.of(200, "{\"commandId\":\"" + INTENT_ID
                        + "\",\"eventId\":\"intent\",\"version\":-1,\"completed\":false}"),
                Arguments.of(200, "{\"commandId\":\"" + INTENT_ID
                        + "\",\"eventId\":\"intent\",\"version\":0,\"completed\":true}"),
                Arguments.of(200, "{\"commandId\":\"" + INTENT_ID
                        + "\",\"eventId\":\"intent\",\"version\":-1,\"completed\":true}"),
                Arguments.of(200, "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"intent\",\"version\":1}"),
                Arguments.of(200, "{\"commandId\":\"" + INTENT_ID
                        + "\",\"eventId\":\"intent\",\"version\":1,\"completed\":null}"));
    }

    @ParameterizedTest
    @MethodSource("incompleteIntentBodies")
    void incompleteIntentCannotStartOrCompleteAClaim(int responseStatus, String body) throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents",
                request -> new MockUpstream.Response(responseStatus, body));
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "retry-intent")
                        .contentType("application/json").content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(LINK.received()).isEmpty();
        assertThat(DATA.hits("POST /internal/invite-links/claim-confirmations")).isZero();
        DATA.on("POST /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":true}"));
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "retry-intent")
                        .contentType("application/json").content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isOk());
        assertThat(LINK.received()).isEmpty();
    }

    @ParameterizedTest
    @MethodSource("absentConfirmBodies")
    void absentConfirmationKeepsTheIntentRetryable(int responseStatus, String body) throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":false}"));
        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(200,
                "{\"claimId\":\"" + CLAIM_ID + "\",\"capability\":\"cap-token\"}"));
        DATA.on("POST /internal/invite-links/claim-confirmations",
                request -> new MockUpstream.Response(responseStatus, body));
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "retry-confirm")
                        .contentType("application/json").content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned")).isZero();
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/completed")).isZero();
        DATA.on("POST /internal/invite-links/claim-confirmations", request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + CONFIRM_ID + "\",\"eventId\":\"e2\",\"version\":2}"));
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "retry-confirm")
                        .contentType("application/json").content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor("POST /internal/invite-links/claim-confirmations")).hasSize(2)
                .allSatisfy(request -> assertThat(request.header("Idempotency-Key"))
                        .isEqualTo("retry-confirm:claim-confirm"));
    }

    @ParameterizedTest
    @MethodSource("absentPendingBodies")
    void absentPendingBodyKeepsTheIntentForRetryWithTheSameKey(int responseStatus, String body) throws Exception {
        stubActiveUser(USER);
        AtomicBoolean abandoned = new AtomicBoolean();
        DATA.on("POST /internal/invite-links/claim-intents", request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":"
                        + abandoned.get() + "}"));
        DATA.on("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned", request -> {
            abandoned.set(true);
            return new MockUpstream.Response(200, "{}");
        });
        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(responseStatus, body));

        var first = mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "same-claim")
                        .contentType("application/json").content("{\"slug\":\"abc123\"}"))
                .andReturn().getResponse();
        assertThat(abandoned).isFalse();
        assertThat(first.getStatus()).isEqualTo(502);
        assertThat(first.getContentAsString()).contains("UPSTREAM_CONTRACT_MISMATCH");
        assertThat(DATA.hits("POST /internal/invite-links/claim-confirmations")).isZero();

        LINK.on("POST /internal/links/abc123/claim", request -> new MockUpstream.Response(200,
                "{\"claimId\":\"" + CLAIM_ID + "\",\"capability\":\"cap-token\"}"));
        DATA.on("POST /internal/invite-links/claim-confirmations", request -> new MockUpstream.Response(200,
                "{\"commandId\":\"" + CONFIRM_ID + "\",\"eventId\":\"e2\",\"version\":2}"));
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "same-claim")
                        .contentType("application/json").content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor("POST /internal/invite-links/claim-intents")).hasSize(2)
                .allSatisfy(request -> assertThat(request.header("Idempotency-Key")).isEqualTo("same-claim:claim-intent"));
        assertThat(LINK.receivedFor("POST /internal/links/abc123/claim")).hasSize(2)
                .allSatisfy(request -> assertThat(request.header("Idempotency-Key")).isEqualTo("same-claim:link-claim"));
        assertThat(DATA.hits("POST /internal/invite-links/claim-confirmations")).isEqualTo(1);
        assertThat(abandoned).isFalse();
    }

    /**
     * 발급 컨텍스트. ⚠️ {@code membershipEpoch == linkVersion} 이어야 한다 — 링크 서버가
     * {@code epoch !== linkVersion} 이면 {@code ISSUE_EPOCH_MISMATCH} 400 으로 거절한다
     * ({@code link/src/lib/links.ts:34}). 두 값이 갈리는 것은 폐기(revoke)뿐이다(A22 ㋑).
     */
    private static String issueContext(boolean groupActive, boolean member) {
        return issueContext(groupActive, member, 8, 8);
    }

    private static String issueContext(boolean groupActive, boolean member, long epoch, long linkVersion) {
        return """
                {"groupActive":%s,"inviterActiveMember":%s,"membershipEpoch":%d,"linkVersion":%d,
                 "transitionSeq":31,"snapshotVersion":4,"groupName":"우리섬",
                 "inviterDisplayName":"재영","groupId":"%s","inviterId":"%s"}"""
                .formatted(groupActive, member, epoch, linkVersion, GROUP, INVITER);
    }

    @Test
    @DisplayName("발급: Data 판정을 받아 링크에 동봉한다 — linkVersion·membershipEpoch·transitionSeq·snapshotVersion 넷 다")
    void 발급조합() throws Exception {
        stubActiveUser(USER);
        DATA.on("GET /internal/groups/" + GROUP + "/invite-issue-context",
                request -> new MockUpstream.Response(200, issueContext(true, true)));
        LINK.on("POST /internal/links", request ->
                new MockUpstream.Response(200,
                        "{\"slug\":\"abc123\",\"url\":\"https://l/abc123?g=" + GROUP + "\"}"));

        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("abc123"))
                .andExpect(jsonPath("$.url").value("https://l/abc123?g=" + GROUP));

        String body = LINK.receivedFor("POST /internal/links").get(0).body();
        // 네 값이 각자 다른 경합을 막는다 — 하나라도 빠지면 역순 검증이 성립하지 않는다.
        assertThat(body).contains("\"linkVersion\":8", "\"membershipEpoch\":8",
                "\"transitionSeq\":31", "\"snapshotVersion\":4");
        assertThat(body).contains("우리섬", "재영");
    }

    @Test
    @DisplayName("발급: epoch != linkVersion 은 계약 위반이라 502 — 링크에 보내면 ISSUE_EPOCH_MISMATCH 400 이 된다")
    void 발급epoch불일치는계약위반() throws Exception {
        stubActiveUser(USER);
        DATA.on("GET /internal/groups/" + GROUP + "/invite-issue-context",
                request -> new MockUpstream.Response(200, issueContext(true, true, 9, 7)));

        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));

        // 링크를 부르지 않았다 — 그 400 을 앱에 중계하면 사용자에게 엉뚱한 문구가 뜬다.
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    @DisplayName("발급: 그룹이 죽었으면 GROUP_NOT_FOUND 404 — 기존 코드를 그대로 쓴다")
    void 죽은그룹() throws Exception {
        stubActiveUser(USER);
        DATA.on("GET /internal/groups/" + GROUP + "/invite-issue-context",
                request -> new MockUpstream.Response(200, issueContext(false, true)));

        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));

        // 판정이 「아니오」면 링크를 부르지 않는다 — 조용히 발급되면 죽은 그룹의 slug 가 살아난다.
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    @DisplayName("발급: 멤버가 아니면 NOT_MEMBER 403")
    void 비멤버() throws Exception {
        stubActiveUser(USER);
        DATA.on("GET /internal/groups/" + GROUP + "/invite-issue-context",
                request -> new MockUpstream.Response(200, issueContext(true, false)));

        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_MEMBER"));
    }

    @Test
    @DisplayName("발급: Data 가 도메인 코드를 주면 그대로 중계한다 — 재해석하면 앱 분기가 빠진다")
    void 상류도메인코드중계() throws Exception {
        stubActiveUser(USER);
        DATA.on("GET /internal/groups/" + GROUP + "/invite-issue-context", request ->
                new MockUpstream.Response(403,
                        "{\"code\":\"NOT_MEMBER\",\"message\":\"그룹원만 초대 링크를 만들 수 있습니다.\"}"));

        mockMvc.perform(post("/api/v1/groups/" + GROUP + "/invite-link")
                        .header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_MEMBER"))
                .andExpect(jsonPath("$.message").value("그룹원만 초대 링크를 만들 수 있습니다."));
    }

    @Test
    @DisplayName("claim: 내구 적재 → 링크 잠정 → Data 확정 순서로 간다. Business 는 링크에 confirm 하지 않는다 (A22 ㋟)")
    void claim조합순서() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":false}"));
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(200,
                        "{\"claimId\":\"" + CLAIM_ID + "\",\"capability\":\"cap-token\",\"groupId\":\""
                                + GROUP + "\"}"));
        DATA.on("POST /internal/invite-links/claim-confirmations", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + CONFIRM_ID + "\",\"eventId\":\"e2\",\"version\":11}"));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isOk());

        // 내구 적재가 링크 호출보다 먼저다 — 그 커밋이 202 의 유일한 근거다.
        assertThat(DATA.received().get(0).methodAndPath())
                .isEqualTo("GET /internal/users/" + USER + "/activation");
        assertThat(DATA.received().get(1).methodAndPath())
                .isEqualTo("POST /internal/invite-links/claim-intents");

        // 링크에는 claim 만 갔다. confirm 은 Data 의 락 아래 outbox + relay 가 하므로 링크 직접 호출이 없다.
        assertThat(LINK.received()).hasSize(1);
        assertThat(LINK.received().get(0).methodAndPath()).isEqualTo("POST /internal/links/abc123/claim");

        // 링크가 서명한 자격이 Data 확정 요청에 실려 트랜잭션 경계까지 간다(A22 ⓚ).
        assertThat(DATA.receivedFor("POST /internal/invite-links/claim-confirmations").get(0).body())
                .contains("cap-token", CLAIM_ID);

        // 확정이 있었으므로 의도를 밖에서 닫지 않는다 — Data 가 «멤버십 락 아래» 같은 커밋에서 닫고,
        // 밖에서 덮으면 그 확정을 몰고 온 재개 실행자의 완료 보고가 낡은 보고로 거절된다.
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned")).isZero();
        // 그리고 이 경로로는 애초에 닫히지 않는다 — 봉투 eventId 로 알림 전달을 닫는 표면이라 항상 404 다.
        assertThat(DATA.hits("POST /internal/outbox-commands/" + INTENT_ID + "/delivered")).isZero();
    }

    @Test
    @DisplayName("claim: 링크가 SLUG_NOT_FOUND 를 주면 404 로 중계하고 «내가 만든 의도를 내가 닫는다»")
    void claim판정은중계() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":false}"));
        // link/src/lib/links.ts:147 — links 행 자체가 없다. 재시도해도 같은 부재를 다시 읽는다.
        LINK.on("POST /internal/links/nope/claim", request ->
                new MockUpstream.Response(404,
                        "{\"code\":\"SLUG_NOT_FOUND\",\"message\":\"초대 링크를 찾을 수 없습니다.\"}"));
        DATA.on("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned",
                request -> new MockUpstream.Response(200, null));

        // 앱 계약은 그대로다 — 202 로 접으면 앱이 영영 못 알고, 코드를 바꾸면 앱 분기가 빠진다.
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"nope\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SLUG_NOT_FOUND"));

        // ⚠️ 이 한 줄이 「로그인마다 한 행씩 무한 적재」를 막는다. 확정이 없어 Data 의 종결 경로가 돌지
        //    않고, 앱은 claim 용 Idempotency-Key 를 보내지 않아(deferredInvite.ts) 로그인마다 «새»
        //    의도가 하나씩 더 쌓인다 — 닫는 손이 여기뿐이다.
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned"))
                .isEqualTo(1);
        assertThat(DATA.receivedFor("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned")
                .get(0).header("X-User-Id")).isEqualTo(USER.toString());
        // 확정은 부르지 않는다 — 붙일 claim 자체가 없다.
        assertThat(DATA.hits("POST /internal/invite-links/claim-confirmations")).isZero();
    }

    @Test
    @DisplayName("claim: 종결이 실패해도 앱이 받는 상태·코드는 그대로 404 SLUG_NOT_FOUND 다")
    void 판정종결실패해도판정은그대로() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":false}"));
        LINK.on("POST /internal/links/nope/claim", request ->
                new MockUpstream.Response(404,
                        "{\"code\":\"SLUG_NOT_FOUND\",\"message\":\"초대 링크를 찾을 수 없습니다.\"}"));
        // 뒷정리가 깨져도 앱 분기는 상류 판정을 봐야 한다 — 여기서 500 이 새면 앱은 「서버 장애」로 읽는다.
        DATA.on("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned", request ->
                new MockUpstream.Response(409, "{\"code\":\"CLAIM_INTENT_LEASE_STALE\",\"message\":\"x\"}"));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"nope\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SLUG_NOT_FOUND"));
    }

    @Test
    @DisplayName("claim: 「나중에 다시 오라」(429·retryAfterMs)는 의도를 지우지 않는다 — 지우면 재시도 근거가 사라진다")
    void 일시적거절은의도를남긴다() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":false}"));
        // 상류가 재시도 시각을 계산해 줬다 = 정의상 종결이 아니다. 코드 이름이 무엇이든 마찬가지다.
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(429,
                        "{\"code\":\"RATE_LIMITED\",\"message\":\"잠시 후 다시 시도해 주세요.\",\"retryAfterMs\":4200}"));
        DATA.on("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"))
                .andExpect(jsonPath("$.retryAfterMs").value(4200));

        // 의도는 큐에 남아야 한다 — 앱의 다음 시도나 재개 CLI 가 이어받을 유일한 근거다.
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned"))
                .isZero();
    }

    @Test
    @DisplayName("claim: 서비스 토큰 거절(401)은 502 로 접히고 의도는 남는다 — 사용자에게 401 을 주지 않는다")
    void 자격거절은의도를남긴다() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":false}"));
        // 서비스 401은 본문 INVALID_SERVICE_TOKEN도 명시적으로 서비스 자격 실패로 분류한다.
        // 앱에는 502를 내려 배포·시크릿 배선 장애가 정상 사용자 세션의 재로그인을 유발하지 않게 한다.
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(401,
                        "{\"code\":\"INVALID_SERVICE_TOKEN\",\"message\":\"INVALID_SERVICE_TOKEN\"}"));
        DATA.on("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CREDENTIAL_REJECTED"));

        // 배선 사고는 「이 사용자에 대한 판정」이 아니다 — 고치고 다시 부르면 답이 달라진다.
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned"))
                .isZero();
    }

    @Test
    @DisplayName("claim: 코드가 실린 403 은 판정으로 중계되지만 종결 대상이 아니다 — 의도를 남긴다")
    void 권한거절은의도를남긴다() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":false}"));
        // ⚠️ 링크 서버는 «모든» 실패 본문에 code 를 싣는다(link/src/lib/errors.ts respond). 403 은
        //    인증 챌린지가 없어 본문이 그대로 살아 오므로, 경로 허용목록 배선 사고
        //    (link/src/lib/auth.ts:60)가 «도메인 판정»으로 들어온다. 이걸 종결로 접으면 잘못된 배포
        //    한 번에 대기 의도가 통째로 지워진다 — 이 테스트가 그 자리를 지킨다.
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(403,
                        "{\"code\":\"SERVICE_ROUTE_FORBIDDEN\",\"message\":\"SERVICE_ROUTE_FORBIDDEN\"}"));
        DATA.on("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SERVICE_ROUTE_FORBIDDEN"));

        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned"))
                .isZero();
    }

    @Test
    @DisplayName("claim: 링크가 claimId=null 을 주면 확정을 건너뛰고 200 — 「붙일 곳이 없을 뿐 오류가 아니다」")
    void 붙일대상없어도200() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":false}"));
        // link/src/lib/links.ts:145·149 — 셀프 초대이거나 붙일 클릭이 없으면 이 모양이 «정상»이다.
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(200, "{\"claimId\":null,\"capability\":null,\"groupId\":null}"));
        DATA.on("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned",
                request -> new MockUpstream.Response(200, null));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isOk());

        // null claimId 로 확정을 부르면 Data 가 거절한다 — 건너뛰어야 한다.
        assertThat(DATA.hits("POST /internal/invite-links/claim-confirmations")).isZero();

        // 그래서 의도를 닫는 손이 여기뿐이다 — 닫지 않으면 정상 처리된 claim 의 의도가 PENDING 으로
        // 남아 재개 CLI 의 「미완료 0」 gate 를 영구히 막는다.
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned"))
                .isEqualTo(1);
        assertThat(DATA.receivedFor("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned")
                .get(0).header("X-User-Id")).isEqualTo(USER.toString());
        // ⚠️ 봉투 완료표시 경로로는 닫지 않는다 — claim 의도는 outbox 행이 아니라 항상 404 다.
        assertThat(DATA.hits("POST /internal/outbox-commands/" + INTENT_ID + "/delivered")).isZero();
    }

    @Test
    @DisplayName("claim: 의도 종결이 404 로 실패해도 사용자에게는 200 이다 — 남은 의도는 재개 CLI 가 같은 판정으로 닫는다")
    void 종결실패는사용자요청을깨지않는다() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1,\"completed\":false}"));
        LINK.on("POST /internal/links/abc123/claim", request ->
                new MockUpstream.Response(200, "{\"claimId\":null,\"capability\":null,\"groupId\":null}"));
        // 남의 것·없는 것을 한 코드로 접은 Data 의 판정. 여기서 올리면 아무 문제 없이 끝난 claim 이
        // 사용자에게 오류로 보인다.
        DATA.on("POST /internal/invite-links/claim-intents/" + INTENT_ID + "/abandoned", request ->
                new MockUpstream.Response(404,
                        "{\"code\":\"CLAIM_INTENT_NOT_FOUND\",\"message\":\"처리할 초대 대기 항목이 없습니다.\"}"));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("claim: 내구 적재가 실패하면 202 를 주지 않는다 — 큐 커밋 전 202 는 유실을 성공으로 위장한다")
    void 적재실패면202아님() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents",
                request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isServiceUnavailable());

        // 링크에도 아무것도 가지 않았다.
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    @DisplayName("claim: 과도하게 긴 Idempotency-Key 는 400 이다 — 상류 컬럼(200자)을 넘겨 500 으로 터지게 두지 않는다")
    void 긴멱등키는400() throws Exception {
        stubActiveUser(USER);

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .header("Idempotency-Key", "k".repeat(190))
                        .contentType("application/json")
                        .content("{\"slug\":\"abc123\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));

        // 상류를 부르지 않았다 — 잘라 보내면 서로 다른 명령이 같은 키로 접혀 남의 응답이 재생된다.
        assertThat(DATA.hits("POST /internal/invite-links/claim-intents")).isZero();
        assertThat(LINK.received()).isEmpty();
    }

    @Test
    @DisplayName("claim: slug 제약은 기존과 같다 — 12자 초과는 400 INVALID_REQUEST")
    void slug제약보존() throws Exception {
        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"0123456789abcdef\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
}
