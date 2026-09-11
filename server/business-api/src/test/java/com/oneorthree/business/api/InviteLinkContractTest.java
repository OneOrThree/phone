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

/** 초대 링크 발급·claim 조합 계약. 기존 URI·성공상태·오류코드 보존이 핵심이다. */
@DisplayName("초대 링크 조합")
class InviteLinkContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
    private static final UUID GROUP = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID INVITER = USER;
    private static final String INTENT_ID = "dddddddd-0000-0000-0000-000000000001";
    private static final String CONFIRM_ID = "dddddddd-0000-0000-0000-000000000002";
    private static final String CLAIM_ID = "eeeeeeee-0000-0000-0000-000000000001";

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
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1}"));
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
    @DisplayName("claim: 링크가 SLUG_NOT_FOUND 를 주면 404 로 중계한다 — 202 로 접으면 앱이 영영 못 안다")
    void claim판정은중계() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1}"));
        LINK.on("POST /internal/links/nope/claim", request ->
                new MockUpstream.Response(404,
                        "{\"code\":\"SLUG_NOT_FOUND\",\"message\":\"초대 링크를 찾을 수 없습니다.\"}"));

        mockMvc.perform(post("/api/v1/invite-links/claim")
                        .header("Authorization", "Bearer " + Tokens.access(USER))
                        .contentType("application/json")
                        .content("{\"slug\":\"nope\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SLUG_NOT_FOUND"));
    }

    @Test
    @DisplayName("claim: 링크가 claimId=null 을 주면 확정을 건너뛰고 200 — 「붙일 곳이 없을 뿐 오류가 아니다」")
    void 붙일대상없어도200() throws Exception {
        stubActiveUser(USER);
        DATA.on("POST /internal/invite-links/claim-intents", request ->
                new MockUpstream.Response(200,
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1}"));
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
                        "{\"commandId\":\"" + INTENT_ID + "\",\"eventId\":\"e1\",\"version\":1}"));
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
