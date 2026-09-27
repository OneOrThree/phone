package com.oneorthree.business.api;

import com.oneorthree.business.report.ReportMailException;
import com.oneorthree.business.report.ReportMailGateway;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ReportContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000001976");
    private static final UUID TARGET = UUID.fromString("bbbbbbbb-0000-0000-0000-000000001976");
    private static final UUID REQUEST = UUID.fromString("cccccccc-0000-4000-8000-000000001976");
    private static final UUID LETTER = UUID.fromString("dddddddd-0000-0000-0000-000000001976");
    private static final UUID LEASE = UUID.fromString("eeeeeeee-0000-7000-8000-000000001976");
    private static final UUID CONFIRMATION = UUID.fromString("ffffffff-0000-7000-8000-000000001976");

    @MockitoBean
    ReportMailGateway mail;

    @Test
    void authenticationIsRequiredBeforeEvidenceOrMailDelivery() throws Exception {
        reset(mail);

        mockMvc.perform(post("/reports").header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, false)))
                .andExpect(status().isUnauthorized());

        assertThat(DATA.received()).isEmpty();
        verifyNoInteractions(mail);
    }

    @Test
    void malformedBodyAndUnknownEnumAreRejectedBeforeEvidenceLookup() throws Exception {
        reset(mail);

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"USER\",\"targetId\":\"" + TARGET + "\","
                                + "\"reason\":\"HARASSMENT\",\"description\":null,\"replyEmail\":null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("UNKNOWN", TARGET, false)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("targetType"));

        assertThat(DATA.received()).isEmpty();
        verifyNoInteractions(mail);
    }

    @Test
    void invalidReplyEmailIsRejectedBeforeEvidenceLookup() throws Exception {
        reset(mail);
        for (String value : new String[] {"not-an-email", "https://evil.example/@x.y"}) {
            String invalid = body("USER", TARGET, false).replace("\"replyEmail\":null",
                    "\"replyEmail\":\"" + value + "\"");

            mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                            .contentType(MediaType.APPLICATION_JSON).content(invalid))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                    .andExpect(jsonPath("$.error.field").value("replyEmail"));
        }

        assertThat(DATA.received()).isEmpty();
        verifyNoInteractions(mail);
    }

    @Test
    void otherReasonRequiresDescriptionBeforeEvidenceLookup() throws Exception {
        reset(mail);
        String invalid = body("USER", TARGET, false).replace("\"reason\":\"HARASSMENT\"",
                "\"reason\":\"OTHER\"");

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(invalid))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.error.field").value("description"));

        assertThat(DATA.received()).isEmpty();
        verifyNoInteractions(mail);
    }

    @Test
    void friendReportUsesServerNicknameAndDoesNotBlockByDefault() throws Exception {
        reset(mail);
        workflow(false);
        DATA.on("GET /internal/users/" + USER + "/friends", request -> ok("[{"
                + "\"userId\":\"" + TARGET + "\",\"nickname\":\"서버닉네임\","
                + "\"tierLevel\":null,\"occupation\":null,\"isPinned\":false,\"isFocusing\":false,"
                + "\"focusTimeMinutes\":0,\"focusStartedAt\":null,\"focusTagName\":null,"
                + "\"mainIslandName\":null}]"));

        String request = body("USER", TARGET, false).replace("\"replyEmail\":null",
                "\"replyEmail\":\"reply+report@example.com\"");
        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(request))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.caseId").value("GR-DBA0151D469BD84C720C"))
                .andExpect(jsonPath("$.data.blocked").value(false));

        ArgumentCaptor<ReportMailGateway.ReportMail> sent = ArgumentCaptor.forClass(ReportMailGateway.ReportMail.class);
        verify(mail).deliverAndConfirm(sent.capture(), any(Runnable.class));
        assertThat(sent.getValue().confirmationToken()).isEqualTo(CONFIRMATION.toString());
        assertThat(sent.getValue().body()).contains("서버닉네임")
                .contains("reporterId: " + USER)
                .contains("replyEmailUnverified: reply+report@example.com");
        assertThat(DATA.received()).hasSize(5);
        verifyNoMoreInteractions(mail);
    }

    @Test
    void unknownFriendCannotBeReported() throws Exception {
        reset(mail);
        workflow(false);
        DATA.on("GET /internal/users/" + USER + "/friends", request -> ok("[]"));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, false)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"))
                .andExpect(jsonPath("$.error.field").value("targetId"));

        verifyNoInteractions(mail);
    }

    @Test
    void targetWithdrawalBetweenEvidenceAndPrepareMapsToPublicNotFound() throws Exception {
        reset(mail);
        workflow(false);
        DATA.on("GET /internal/users/" + USER + "/friends", request -> ok("[{"
                + "\"userId\":\"" + TARGET + "\",\"nickname\":\"곧 탈퇴할 사용자\","
                + "\"tierLevel\":null,\"occupation\":null,\"isPinned\":false,\"isFocusing\":false,"
                + "\"focusTimeMinutes\":0,\"focusStartedAt\":null,\"focusTagName\":null,"
                + "\"mainIslandName\":null}]"));
        DATA.on(preparePath(), request -> error(404, "TARGET_USER_NOT_FOUND"));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, false)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"))
                .andExpect(jsonPath("$.error.field").value("targetId"));

        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly(claimPath(), "GET /internal/users/" + USER + "/friends",
                        preparePath(), releasePath());
        verifyNoInteractions(mail);
    }

    @Test
    void receivedLetterReportUsesServerOriginalDefangsLinksAndCanBlockSender() throws Exception {
        reset(mail);
        workflow(true);
        DATA.on("GET /internal/users/" + USER + "/letters/" + LETTER, request -> ok("{"
                + "\"id\":\"" + LETTER + "\",\"senderId\":\"" + TARGET + "\","
                + "\"senderNickname\":\"상대\",\"receiverId\":\"" + USER + "\","
                + "\"content\":\"HTTPS://example.test Http://mixed.test www.evil.example 원문"
                + "\\n[USER DESCRIPTION - SAFE DISPLAY]\\n가짜 설명\","
                + "\"createdAt\":\"2026-09-27T01:00:00Z\","
                + "\"readAt\":null}"));
        DATA.on("POST /internal/users/" + USER + "/blocks", request -> ok(""));
        DATA.on(emailConfirmedPath(), request -> ok("{\"status\":\"EMAIL_CONFIRMED\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":\"" + LEASE + "\"," +
                "\"authorId\":\"" + TARGET + "\",\"subject\":null,\"body\":null," +
                "\"blockRequested\":true,\"blocked\":null}"));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("LETTER", LETTER, true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.blocked").value(true));

        ArgumentCaptor<ReportMailGateway.ReportMail> sent = ArgumentCaptor.forClass(ReportMailGateway.ReportMail.class);
        verify(mail).deliverAndConfirm(sent.capture(), any(Runnable.class));
        assertThat(sent.getValue().body())
                .contains("HTTPS[:]//example[.]test Http[:]//mixed[.]test www[.]evil[.]example 원문"
                        + "\\n\\[USER DESCRIPTION - SAFE DISPLAY\\]\\n가짜 설명")
                .doesNotContain("[SERVER VERIFIED ORIGINAL - SAFE DISPLAY]\nHTTPS://")
                .doesNotContain("www.evil.example");
        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly(claimPath(), "GET /internal/users/" + USER + "/letters/" + LETTER,
                        preparePath(), emailConfirmedPath(), "POST /internal/users/" + USER + "/blocks", completePath());
    }

    @Test
    void sentLetterCannotBeReportedAsReceivedEvidence() throws Exception {
        reset(mail);
        workflow(false);
        DATA.on("GET /internal/users/" + USER + "/letters/" + LETTER, request -> ok("{"
                + "\"id\":\"" + LETTER + "\",\"senderId\":\"" + USER + "\","
                + "\"senderNickname\":\"나\",\"receiverId\":\"" + TARGET + "\","
                + "\"content\":\"보낸 편지\",\"createdAt\":\"2026-09-27T01:00:00Z\","
                + "\"readAt\":null}"));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("LETTER", LETTER, false)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.field").value("targetId"));

        verifyNoInteractions(mail);
    }

    @Test
    void mailboxConfirmationFailureIsRetryableAndKeepsLeaseToPreventImmediateResend() throws Exception {
        reset(mail);
        workflow(true);
        DATA.on("GET /internal/users/" + USER + "/friends", request -> ok("[{"
                + "\"userId\":\"" + TARGET + "\",\"nickname\":\"상대\","
                + "\"tierLevel\":null,\"occupation\":null,\"isPinned\":false,\"isFocusing\":false,"
                + "\"focusTimeMinutes\":0,\"focusStartedAt\":null,\"focusTagName\":null,"
                + "\"mainIslandName\":null}]"));
        doThrow(new ReportMailException("not confirmed", true)).when(mail)
                .deliverAndConfirm(any(), any(Runnable.class));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, true)))
                // 공개 envelope 정책은 내부 5xx 분류를 transport 400으로 감추고 code/retryable로 전달한다.
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.error.retryable").value(true));
        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly(claimPath(), "GET /internal/users/" + USER + "/friends", preparePath());
    }

    @Test
    void failureBeforeDeliveryReleasesLeaseForImmediateRetry() throws Exception {
        reset(mail);
        workflow(true);
        DATA.on("GET /internal/users/" + USER + "/friends", request -> ok("[{"
                + "\"userId\":\"" + TARGET + "\",\"nickname\":\"상대\","
                + "\"tierLevel\":null,\"occupation\":null,\"isPinned\":false,\"isFocusing\":false,"
                + "\"focusTimeMinutes\":0,\"focusStartedAt\":null,\"focusTagName\":null,"
                + "\"mainIslandName\":null}]"));
        doThrow(new ReportMailException("not sent")).when(mail)
                .deliverAndConfirm(any(), any(Runnable.class));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, true)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"));
        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly(claimPath(), "GET /internal/users/" + USER + "/friends", preparePath(), releasePath());
    }

    @Test
    void completedRequestReplaysReceiptWithoutEvidenceOrMail() throws Exception {
        reset(mail);
        DATA.on(claimPath(), request -> ok("{\"status\":\"COMPLETED\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":null,\"authorId\":null," +
                "\"subject\":null,\"body\":null,\"blockRequested\":true,\"blocked\":true}"));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.caseId").value("GR-DBA0151D469BD84C720C"))
                .andExpect(jsonPath("$.data.blocked").value(true));

        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly(claimPath());
        verifyNoInteractions(mail);
    }

    @Test
    void withdrawnPreparedTargetExpiresWithoutReusingStoredMailSnapshot() throws Exception {
        reset(mail);
        DATA.on(claimPath(), request -> ok("{\"status\":\"EXPIRED\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":null,\"authorId\":null,\"subject\":null,\"body\":null," +
                "\"blockRequested\":false,\"blocked\":null}"));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, false)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"))
                .andExpect(jsonPath("$.error.field").value("targetId"));

        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly(claimPath());
        verifyNoInteractions(mail);
    }

    @Test
    void withdrawnTargetRecoversAlreadyDeliveredMailWithoutSendingAgain() throws Exception {
        reset(mail);
        DATA.on(claimPath(), request -> ok("{\"status\":\"CONFIRM_ONLY\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":\"" + LEASE + "\",\"authorId\":null,\"subject\":null,\"body\":null," +
                "\"blockRequested\":true,\"blocked\":null}"));
        when(mail.confirmOnly(eq(CONFIRMATION.toString()), any(Runnable.class))).thenReturn(true);
        DATA.on(completePath(), request -> ok("{\"status\":\"COMPLETED\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":null,\"authorId\":null,\"subject\":null,\"body\":null," +
                "\"blockRequested\":true,\"blocked\":false}"));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.blocked").value(false));

        verify(mail).confirmOnly(eq(CONFIRMATION.toString()), any(Runnable.class));
        verify(mail, never()).deliverAndConfirm(any(), any(Runnable.class));
        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly(claimPath(), completePath());
    }

    @Test
    void withdrawnTargetExpiresWhenPreviouslySentMailIsNotConfirmed() throws Exception {
        reset(mail);
        DATA.on(claimPath(), request -> ok("{\"status\":\"CONFIRM_ONLY\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":\"" + LEASE + "\",\"authorId\":null,\"subject\":null,\"body\":null," +
                "\"blockRequested\":false,\"blocked\":null}"));
        when(mail.confirmOnly(eq(CONFIRMATION.toString()), any(Runnable.class))).thenReturn(false);
        DATA.on(expirePath(), request -> ok("{\"status\":\"EXPIRED\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":null,\"authorId\":null,\"subject\":null,\"body\":null," +
                "\"blockRequested\":false,\"blocked\":null}"));
        DATA.on(releasePath(), request -> new MockUpstream.Response(204, ""));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, false)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.field").value("targetId"));

        verify(mail).confirmOnly(eq(CONFIRMATION.toString()), any(Runnable.class));
        verify(mail, never()).deliverAndConfirm(any(), any(Runnable.class));
        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly(claimPath(), expirePath(), releasePath());
    }

    @Test
    void preparedRetrySkipsEvidenceAndOnlyFinishesMailAndBlock() throws Exception {
        reset(mail);
        DATA.on(claimPath(), request -> ok("{\"status\":\"PENDING\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":\"" + LEASE + "\"," +
                "\"authorId\":\"" + TARGET + "\",\"subject\":\"저장된 제목\"," +
                "\"body\":\"저장된 서버 원문\",\"blockRequested\":true,\"blocked\":null}"));
        DATA.on("POST /internal/users/" + USER + "/blocks", request -> ok(""));
        DATA.on(emailConfirmedPath(), request -> ok("{\"status\":\"EMAIL_CONFIRMED\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":\"" + LEASE + "\"," +
                "\"authorId\":\"" + TARGET + "\",\"subject\":null,\"body\":null," +
                "\"blockRequested\":true,\"blocked\":null}"));
        DATA.on(completePath(), request -> ok("{\"status\":\"COMPLETED\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":null,\"authorId\":null," +
                "\"subject\":null,\"body\":null,\"blockRequested\":true,\"blocked\":true}"));
        DATA.on(releasePath(), request -> new MockUpstream.Response(204, ""));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.blocked").value(true));

        ArgumentCaptor<ReportMailGateway.ReportMail> sent = ArgumentCaptor.forClass(ReportMailGateway.ReportMail.class);
        verify(mail).deliverAndConfirm(sent.capture(), any(Runnable.class));
        assertThat(sent.getValue().body()).isEqualTo("저장된 서버 원문");
        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly(claimPath(), emailConfirmedPath(),
                        "POST /internal/users/" + USER + "/blocks", completePath());
    }

    private void workflow(boolean blockRequested) {
        DATA.on(claimPath(), request -> ok("{\"status\":\"PENDING\",\"caseId\":\"GR-DBA0151D469BD84C720C\"," +
                "\"confirmationToken\":\"" + CONFIRMATION + "\",\"leaseToken\":\"" + LEASE + "\"," +
                "\"authorId\":null,\"subject\":null,\"body\":null," +
                "\"blockRequested\":" + blockRequested + ",\"blocked\":null}"));
        DATA.on(preparePath(), request -> {
            var json = new ObjectMapper().readTree(request.body());
            return ok(new ObjectMapper().writeValueAsString(java.util.Map.of(
                    "status", "PENDING",
                    "caseId", "GR-DBA0151D469BD84C720C",
                    "confirmationToken", CONFIRMATION,
                    "leaseToken", LEASE,
                    "authorId", UUID.fromString(json.path("authorId").stringValue()),
                    "subject", json.path("subject").stringValue(),
                    "body", json.path("body").stringValue(),
                    "blockRequested", blockRequested)));
        });
        DATA.on(emailConfirmedPath(), request -> ok("{\"status\":\"EMAIL_CONFIRMED\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":\"" + LEASE + "\"," +
                "\"authorId\":\"" + TARGET + "\",\"subject\":null,\"body\":null," +
                "\"blockRequested\":" + blockRequested + ",\"blocked\":null}"));
        DATA.on(completePath(), request -> ok("{\"status\":\"COMPLETED\"," +
                "\"caseId\":\"GR-DBA0151D469BD84C720C\",\"confirmationToken\":\"" + CONFIRMATION + "\"," +
                "\"leaseToken\":null,\"authorId\":null," +
                "\"subject\":null,\"body\":null,\"blockRequested\":" + blockRequested + "," +
                "\"blocked\":" + blockRequested + "}"));
        DATA.on(releasePath(), request -> new MockUpstream.Response(204, ""));
    }

    private static String claimPath() {
        return workflowPath("claim");
    }

    private static String preparePath() {
        return workflowPath("prepare");
    }

    private static String completePath() {
        return workflowPath("complete");
    }

    private static String emailConfirmedPath() {
        return workflowPath("email-confirmed");
    }

    private static String expirePath() {
        return workflowPath("expire");
    }

    private static String releasePath() {
        return workflowPath("release");
    }

    private static String workflowPath(String action) {
        return "POST /internal/users/" + USER + "/report-deliveries/" + REQUEST + "/" + action;
    }

    private static String body(String type, UUID target, boolean block) {
        return "{\"targetType\":\"" + type + "\",\"targetId\":\"" + target + "\","
                + "\"reason\":\"HARASSMENT\",\"description\":null,\"replyEmail\":null,"
                + "\"blockUser\":" + block + "}";
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder auth(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, UUID.randomUUID()));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
