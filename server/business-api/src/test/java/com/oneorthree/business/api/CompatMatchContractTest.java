package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;
import java.util.stream.Stream;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 이관 정지 창의 한시 {@code /l/match} 계약 (A22 ㊫ · ㊥ · 서비스 §7.2).
 *
 * <p>{@code import-contract-ready=false} 가 기본 상태이므로 이 클래스가 검증하는 것은 「준비 전에는
 * 구 후보를 소진하지 않는다」다 — 임의 이중 소진 금지가 코드로 서 있는지 본다.
 */
@DisplayName("이관 호환 match")
@TestPropertySource(properties = {
        "business.compat.match-handler-enabled=true",
        "business.compat.import-contract-ready=false",
        "business.compat.migration-id=mig-1"
})
class CompatMatchContractTest extends UpstreamTestBase {

    static Stream<Arguments> absentMatchResults() {
        return Stream.of(Arguments.of(204, null), Arguments.of(200, ""), Arguments.of(200, "null"),
                Arguments.of(200, "{}"), Arguments.of(200, "{\"matched\":null}"));
    }

    @ParameterizedTest
    @MethodSource("absentMatchResults")
    void aMissingLinkMatchDecisionNeverBecomesAnUnmatchedSuccess(int responseStatus, String body) throws Exception {
        DATA.on("GET /internal/migrations/mig-1/invite-link-clicks/candidates",
                request -> new MockUpstream.Response(200, "[]"));
        LINK.on("POST /internal/links/match", request -> new MockUpstream.Response(responseStatus, body));
        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("UPSTREAM_CONTRACT_MISMATCH"));
        LINK.on("POST /internal/links/match", request -> new MockUpstream.Response(200, "{\"matched\":false}"));
        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk()).andExpect(jsonPath("$.matched").value(false));
    }

    private static final String MATCH_BODY =
            "{\"os\":\"ios\",\"deviceId\":\"dev-1\",\"appInstanceId\":\"ga-1\"}";

    @Test
    @DisplayName("무인증이다 — 도달하는 사람은 아직 우리 유저가 아니다(구 앱 deferred 매치)")
    void 무인증() throws Exception {
        LINK.on("POST /internal/links/match", request ->
                new MockUpstream.Response(200,
                        "{\"matched\":true,\"slug\":\"abc123\",\"groupId\":null}"));

        // Authorization 헤더가 없어도 401 이 아니다. 인증을 붙이면 구 앱의 매치가 전멸한다.
        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(true))
                .andExpect(jsonPath("$.slug").value("abc123"));
    }

    @Test
    @DisplayName("import 계약 준비 전에는 구 후보를 링크에 넘기지 않는다 — 넘기면 임의 이중 소진이다 (A22 ㊥)")
    void 준비전에는구후보전달금지() throws Exception {
        DATA.on("GET /internal/migrations/mig-1/invite-link-clicks/candidates", request ->
                new MockUpstream.Response(200, """
                        [{"source":{"clickId":"99999999-0000-0000-0000-000000000001","slug":"old1"},
                          "sourceChecksum":"chk-1"}]"""));
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));

        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(false));

        // 구 후보를 «조회»는 했지만(4단계 진입 판단 입력) 링크에는 아무것도 넘기지 않았다.
        assertThat(DATA.hits("GET /internal/migrations/mig-1/invite-link-clicks/candidates")).isEqualTo(1);
        String sent = LINK.receivedFor("POST /internal/links/match").get(0).body();
        // ⚠️ migrationId 가 «없어야» 한다 — 있으면 링크가 import 모드로 들어가 openRun 을 요구하고
        //    IMPORT_CLOSED 이후엔 빈 배열을 보내도 503 이 된다(link/src/lib/links.ts:104-113).
        assertThat(sent).contains("\"migrationId\":null");
        assertThat(sent).contains("\"frozenCandidates\":null");
        assertThat(sent).doesNotContain("mig-1");
    }

    @Test
    @DisplayName("matched:false 는 200 이고 slug·groupId 가 JSON 에서 빠진다 — 기존 계약 그대로")
    void 미매치응답모양() throws Exception {
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));

        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(false))
                .andExpect(jsonPath("$.slug").doesNotExist())
                .andExpect(jsonPath("$.groupId").doesNotExist());
    }

    @Test
    @DisplayName("상류 장애를 matched:false 로 접지 않는다 — 앱은 응답만으로 확인 완료라 초대가 영구히 사라진다")
    void 장애는5xx() throws Exception {
        LINK.on("POST /internal/links/match", request -> new MockUpstream.Response(500, "{}"));

        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("UPSTREAM_UNAVAILABLE"));
    }

    @Test
    @DisplayName("구 후보 조회가 실패해도 Neon 후보만으로 매치는 진행한다 — 이관 도구 장애가 정상 설치를 죽이면 안 된다")
    void 구조회실패는무시() throws Exception {
        DATA.on("GET /internal/migrations/mig-1/invite-link-clicks/candidates",
                request -> new MockUpstream.Response(500, "{}"));
        LINK.on("POST /internal/links/match", request ->
                new MockUpstream.Response(200, "{\"matched\":true,\"slug\":\"abc123\"}"));

        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matched").value(true));
    }

    @Test
    @DisplayName("같은 deviceId 재시도는 같은 멱등 키를 만든다 — 두 번째 호출이 다른 클릭을 소진하면 안 된다")
    void deviceId멱등() throws Exception {
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));

        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk());
        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk());

        var calls = LINK.receivedFor("POST /internal/links/match");
        assertThat(calls).hasSize(2);
        assertThat(calls.get(0).header("Idempotency-Key")).isEqualTo(calls.get(1).header("Idempotency-Key"));
        // 본문 해시가 아니라 기기 식별자에서 나온 키다(A22 ㊞).
        assertThat(calls.get(0).header("Idempotency-Key")).contains("dev-1");
    }

    @Test
    @DisplayName("os 는 ios|android|other 만 — 기존 제약 그대로 400")
    void os제약보존() throws Exception {
        mockMvc.perform(post("/l/match").contentType("application/json")
                        .content("{\"os\":\"windows\",\"deviceId\":\"dev-1\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("deviceId 는 64자까지 — 넘으면 저장 단계에서 터지므로 입력에서 막는다")
    void deviceId길이제약() throws Exception {
        mockMvc.perform(post("/l/match").contentType("application/json")
                        .content("{\"os\":\"ios\",\"deviceId\":\"" + "x".repeat(65) + "\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("위조 XFF·CF-Connecting-IP 로는 ipHash 를 고를 수 없다 — 전용 헤더만 믿는다")
    void 위조헤더무시() throws Exception {
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));

        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY)
                        .header("X-Forwarded-For", "203.0.113.9")
                        .header("CF-Connecting-IP", "203.0.113.9")
                        .header("X-Real-IP", "203.0.113.9"))
                .andExpect(status().isOk());
        String forged = LINK.receivedFor("POST /internal/links/match").get(0).body();

        LINK.reset();
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));
        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk());
        String plain = LINK.receivedFor("POST /internal/links/match").get(0).body();

        // 위조 헤더를 넣어도 해시가 달라지지 않는다 = 호출자가 매치 키를 고를 수 없다.
        assertThat(forged).isEqualTo(plain);
    }

    @Test
    @DisplayName("전용 헤더 X-Link-Client-IP 는 «신뢰 피어»에서만 읽힌다 — 그 값이 해시를 바꾼다")
    void 전용헤더는신뢰피어에서만() throws Exception {
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));

        // MockMvc 의 remoteAddr 기본값은 127.0.0.1(루프백) = 신뢰 피어라 전용 헤더가 읽힌다.
        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY)
                        .header("X-Link-Client-IP", "198.51.100.7"))
                .andExpect(status().isOk());
        String withHeader = LINK.receivedFor("POST /internal/links/match").get(0).body();

        LINK.reset();
        LINK.on("POST /internal/links/match",
                request -> new MockUpstream.Response(200, "{\"matched\":false}"));
        mockMvc.perform(post("/l/match").contentType("application/json").content(MATCH_BODY))
                .andExpect(status().isOk());
        String withoutHeader = LINK.receivedFor("POST /internal/links/match").get(0).body();

        assertThat(withHeader).isNotEqualTo(withoutHeader);
    }
}
