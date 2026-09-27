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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ReportContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000001976");
    private static final UUID TARGET = UUID.fromString("bbbbbbbb-0000-0000-0000-000000001976");
    private static final UUID REQUEST = UUID.fromString("cccccccc-0000-4000-8000-000000001976");
    private static final UUID LETTER = UUID.fromString("dddddddd-0000-0000-0000-000000001976");

    @MockitoBean
    ReportMailGateway mail;

    @Test
    void friendReportUsesServerNicknameAndDoesNotBlockByDefault() throws Exception {
        reset(mail);
        DATA.on("GET /internal/users/" + USER + "/friends", request -> ok("[{"
                + "\"userId\":\"" + TARGET + "\",\"nickname\":\"서버닉네임\","
                + "\"tierLevel\":null,\"occupation\":null,\"isPinned\":false,\"isFocusing\":false,"
                + "\"focusTimeMinutes\":0,\"focusStartedAt\":null,\"focusTagName\":null,"
                + "\"mainIslandName\":null}]"));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, false)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.caseId").value("GR-DBA0151D469BD84C720C"))
                .andExpect(jsonPath("$.data.blocked").value(false));

        ArgumentCaptor<ReportMailGateway.ReportMail> sent = ArgumentCaptor.forClass(ReportMailGateway.ReportMail.class);
        verify(mail).deliverAndConfirm(sent.capture());
        assertThat(sent.getValue().body()).contains("서버닉네임").contains("reporterId: " + USER);
        assertThat(DATA.received()).hasSize(1);
        verifyNoMoreInteractions(mail);
    }

    @Test
    void receivedLetterReportUsesServerOriginalDefangsLinksAndCanBlockSender() throws Exception {
        reset(mail);
        DATA.on("GET /internal/users/" + USER + "/letters/" + LETTER, request -> ok("{"
                + "\"id\":\"" + LETTER + "\",\"senderId\":\"" + TARGET + "\","
                + "\"senderNickname\":\"상대\",\"receiverId\":\"" + USER + "\","
                + "\"content\":\"https://example.test 원문\",\"createdAt\":\"2026-09-27T01:00:00Z\","
                + "\"readAt\":null}"));
        DATA.on("POST /internal/users/" + USER + "/blocks", request -> ok(""));

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("LETTER", LETTER, true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.blocked").value(true));

        ArgumentCaptor<ReportMailGateway.ReportMail> sent = ArgumentCaptor.forClass(ReportMailGateway.ReportMail.class);
        verify(mail).deliverAndConfirm(sent.capture());
        assertThat(sent.getValue().body())
                .contains("hxxps[:]//example.test 원문")
                .doesNotContain("[SERVER VERIFIED ORIGINAL - SAFE DISPLAY]\nhttps://");
        assertThat(DATA.received()).extracting(MockUpstream.RecordedRequest::methodAndPath)
                .containsExactly("GET /internal/users/" + USER + "/letters/" + LETTER,
                        "POST /internal/users/" + USER + "/blocks");
    }

    @Test
    void mailboxConfirmationFailureIsRetryableAndDoesNotBlock() throws Exception {
        reset(mail);
        DATA.on("GET /internal/users/" + USER + "/friends", request -> ok("[{"
                + "\"userId\":\"" + TARGET + "\",\"nickname\":\"상대\","
                + "\"tierLevel\":null,\"occupation\":null,\"isPinned\":false,\"isFocusing\":false,"
                + "\"focusTimeMinutes\":0,\"focusStartedAt\":null,\"focusTagName\":null,"
                + "\"mainIslandName\":null}]"));
        doThrow(new ReportMailException("not confirmed")).when(mail).deliverAndConfirm(any());

        mockMvc.perform(auth(post("/reports")).header("Idempotency-Key", REQUEST)
                        .contentType(MediaType.APPLICATION_JSON).content(body("USER", TARGET, true)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.error.retryable").value(true));
        assertThat(DATA.received()).hasSize(1);
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
}
