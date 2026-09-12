package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;
import org.springframework.test.context.TestPropertySource;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

/**
 * import 계약이 <b>준비된 뒤</b>의 호환 match — 구 정지 행을 {@code {source, sourceChecksum}} 래퍼로
 * 그대로 넘긴다(§7.2 4단계).
 */
@DisplayName("이관 호환 match — import 준비 후")
@TestPropertySource(properties = {
        "business.compat.match-handler-enabled=true",
        "business.compat.import-contract-ready=true",
        "business.compat.migration-id=mig-9"
})
class CompatMatchImportReadyTest extends UpstreamTestBase {

    private static final String MATCH_BODY =
            "{\"os\":\"ios\",\"deviceId\":\"dev-9\",\"appInstanceId\":null}";

    static Stream<Arguments> absentCandidateBodies() {
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"));
    }

    @ParameterizedTest
    @MethodSource("absentCandidateBodies")
    void absentCandidateBodyCannotConsumeTheMatchAndTheSameRequestCanRetry(int responseStatus, String body)
            throws Exception {
        DATA.on("GET /internal/migrations/mig-9/invite-link-clicks/candidates",
                request -> new MockUpstream.Response(responseStatus, body));
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));
        mockMvc.perform(post("/l/match").header("Idempotency-Key", "same-install")
                        .contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        assertThat(LINK.received()).isEmpty();

        DATA.on("GET /internal/migrations/mig-9/invite-link-clicks/candidates", request ->
                new MockUpstream.Response(200,
                        "[{\"source\":{\"slug\":\"old9\"},\"sourceChecksum\":\"chk-9\"}]"));
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":true,\"slug\":\"old9\"}"));
        mockMvc.perform(post("/l/match").header("Idempotency-Key", "same-install")
                        .contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk()).andExpect(jsonPath("$.slug").value("old9"));
        assertThat(LINK.receivedFor("POST /internal/links/match")).singleElement()
                .satisfies(request -> assertThat(request.body()).contains("old9", "chk-9"));
    }

    @Test
    void explicitEmptyCandidateArrayStillAllowsAnUnmatchedResult() throws Exception {
        DATA.on("GET /internal/migrations/mig-9/invite-link-clicks/candidates",
                request -> new MockUpstream.Response(200, "[]"));
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));
        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk()).andExpect(jsonPath("$.matched").value(false));
        assertThat(LINK.receivedFor("POST /internal/links/match")).singleElement()
                .satisfies(request -> assertThat(request.body()).contains("\"frozenCandidates\":[]"));
    }

    @Test
    @DisplayName("source 원본 JSON 을 손대지 않고 통째로 넘긴다 — 풀어 조립하면 체크섬이 깨진다")
    void 원본JSON보존() throws Exception {
        DATA.on("GET /internal/migrations/mig-9/invite-link-clicks/candidates", request ->
                new MockUpstream.Response(200, """
                        [{"source":{"clickId":"99999999-0000-0000-0000-000000000009",
                                    "slug":"old9","linkStatus":"ACTIVE","userAgent":null,
                                    "membershipEpoch":"3","transitionSeq":"7"},
                          "sourceChecksum":"chk-9"}]"""));
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));

        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk());

        String sent = LINK.receivedFor("POST /internal/links/match").get(0).body();
        assertThat(sent).contains("\"migrationId\":\"mig-9\"");
        assertThat(sent).contains("\"sourceChecksum\":\"chk-9\"");
        // Data 가 준 필드가 그대로 살아 있다 — 축약하면 링크의 frozen() 검증에서 떨어진다.
        assertThat(sent).contains("old9", "ACTIVE", "\"membershipEpoch\":\"3\"", "\"transitionSeq\":\"7\"");
    }
}
