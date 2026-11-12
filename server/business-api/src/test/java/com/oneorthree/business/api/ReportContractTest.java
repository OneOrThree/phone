package com.oneorthree.business.api;

import org.junit.jupiter.api.Test;
import com.oneorthree.business.support.UpstreamTestBase;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.MockUpstream;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.http.MediaType;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 공개 신고는 서명한 사용자로만 위임하고 관리자 표면을 열지 않는다. */
class ReportContractTest extends UpstreamTestBase {
    private static final UUID USER = UUID.randomUUID();
    private static final UUID SESSION = UUID.randomUUID();
    private static final String PATH = "/internal/users/" + USER + "/reports";
    private static final String BODY = "{\"requestId\":\"" + UUID.randomUUID()
            + "\",\"targetType\":\"OTHER\",\"reason\":\"OTHER\",\"details\":\"신고 내용\"}";

    @Test
    void authenticatesAndForwardsSignedCallerAndReturnsReceiptOnly() throws Exception {
        UUID report = UUID.randomUUID();
        DATA.on("POST " + PATH, request -> ok("{\"reportId\":\"" + report
                + "\",\"receivedAt\":\"2026-11-12T00:00:00Z\"}"));
        mockMvc.perform(auth(post("/reports").contentType(MediaType.APPLICATION_JSON).content(BODY)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.reportId").value(report.toString()));
        assertThat(DATA.received()).hasSize(1).allSatisfy(call -> {
            assertThat(call.header("x-user-id")).isEqualTo(USER.toString());
            var sent = new tools.jackson.databind.ObjectMapper().readTree(call.body());
            assertThat(sent.get("sessionId").stringValue()).isEqualTo(SESSION.toString());
            assertThat(sent.get("authGeneration").intValue()).isEqualTo(3);
            assertThat(sent.get("report").get("details").stringValue()).isEqualTo("신고 내용");
        });
        mockMvc.perform(post("/reports").contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void inactiveSessionRequiresReauthenticationInsteadOfUpstreamFailure() throws Exception {
        DATA.on("POST " + PATH, request -> new MockUpstream.Response(403,
                "{\"code\":\"SESSION_NOT_ACTIVE\",\"message\":\"종료된 세션\"}"));
        mockMvc.perform(auth(post("/reports").contentType(MediaType.APPLICATION_JSON).content(BODY)))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }

    @Test
    void cannotChooseReporterOrBypassValidation() throws Exception {
        mockMvc.perform(auth(post("/reports").contentType(MediaType.APPLICATION_JSON)
                .content(BODY.replace("}", ",\"reporterId\":\"" + UUID.randomUUID() + "\"}"))))
                .andExpect(status().isBadRequest());
        for (String forged : new String[] {"sessionId", "authGeneration"}) {
            mockMvc.perform(auth(post("/reports").contentType(MediaType.APPLICATION_JSON)
                    .content(BODY.replace("}", ",\"" + forged + "\":\"spoofed\"}"))))
                    .andExpect(status().isBadRequest());
        }
        mockMvc.perform(auth(post("/reports").contentType(MediaType.APPLICATION_JSON).content("{}")))
                .andExpect(status().isBadRequest());
        assertThat(DATA.received()).isEmpty();
    }
    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

}
