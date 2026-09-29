package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * AT 재발급 공개 계약 (GROMO-2035) — 실제 필터 체인 · 컨트롤러 · HTTP 로 확인한다.
 *
 * <h2>이 테스트가 «막고 있는» 회귀</h2>
 * 이 경로의 존재 이유는 「AT 가 만료됐을 때」다. 그래서 가장 중요한 단언은
 * {@link #issuesANewAccessTokenWhenTheAccessTokenHasAlreadyExpired()} 의 <b>만료 AT 를 들고 온
 * 요청이 200 을 받는다</b>이다. 누군가 이 경로를 여느 경로처럼 AT 검증 뒤로 옮기면 그 요청은 401 이
 * 되고, 앱의 401 처리가 다시 갱신을 불러 <b>401 → 갱신 → 401 루프</b>가 된다 — 티켓이 없애려던
 * 「한 시간마다 로그아웃」이 그대로 돌아온다. 그 회귀는 이 테스트 하나로만 잡힌다.
 */
class SessionRefreshContractTest extends UpstreamTestBase {

    private static final String PATH = "/auth/sessions/current/refresh";
    private static final String DATA_REFRESH = "POST /internal/auth/sessions/refresh";
    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000002035");

    @BeforeEach
    void stubRefresh() {
        // 미회전 호환 응답 — 계정 LLD §3. 새 AT 는 나가고 RT 는 null 이다.
        DATA.on(DATA_REFRESH, request -> ok("{\"accessToken\":\"fresh-at\",\"refreshToken\":null}"));
    }

    // ── DoD ① 만료된 AT + 유효한 RT → 새 AT ──────────────────────────────────────

    /**
     * <b>이 파일의 핵심 단언이다.</b> {@link Tokens#expired}로 «실제로 만료된» AT 를 서명해 평소처럼
     * Authorization 에 실어 보낸다 — 앱이 401 을 만난 직후의 상태 그대로다. 필터가 이 경로에서도 AT 를
     * 검증하면 여기서 401 이 되고, 그러면 앱의 401 처리가 다시 갱신을 불러 401 → 갱신 → 401 루프가 된다.
     */
    @Test
    @DisplayName("만료된 AT 를 실은 채 유효한 RT 로 부르면 새 AT 를 받는다")
    void issuesANewAccessTokenWhenTheAccessTokenHasAlreadyExpired() throws Exception {
        mockMvc.perform(refresh("valid-refresh-token")
                        .header("Authorization", "Bearer " + Tokens.expired(USER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accessToken").value("fresh-at"))
                .andExpect(jsonPath("$.data.length()").value(2));
    }

    /** AT 를 아예 빼고 RT 만 보내도 같다 — 자격은 RT 하나이고 AT 는 읽히지 않는다. */
    @Test
    @DisplayName("AT 없이 RT 만 보내도 새 AT 를 받는다")
    void issuesANewAccessTokenWithNoAuthorizationHeaderAtAll() throws Exception {
        mockMvc.perform(refresh("valid-refresh-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accessToken").value("fresh-at"));
    }

    /**
     * <b>위조된 AT 를 실어도 갱신은 성공한다</b> — 그 헤더가 읽히지 않는다는 것의 증명이다.
     *
     * <p>이것이 위험해 보인다면 방향이 반대다: 위조 AT 가 «권한을 얻는» 것이 아니라, 아무 영향도
     * 없다는 뜻이다. 주체는 Data 가 RT 서명에서 정한다. 반대로 이 요청이 401 이 되면 그건 필터가
     * 이 경로의 AT 를 다시 보기 시작했다는 신호이고, 그때 만료 AT 경로도 함께 깨진다.
     */
    @Test
    @DisplayName("위조된 AT 를 실어도 결과가 달라지지 않는다 — 읽지 않는 값이라서")
    void ignoresAForgedAccessTokenInsteadOfLettingItDecideTheOutcome() throws Exception {
        mockMvc.perform(refresh("valid-refresh-token")
                        .header("Authorization", "Bearer " + Tokens.signedWithOtherKey(USER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accessToken").value("fresh-at"));
    }

    /**
     * 미회전이 <b>계약</b>이다 (계정 LLD §3 「정상 RT 회전의 클라이언트 전환 gate」).
     *
     * <p>{@code refreshToken} 필드를 «빼지» 않고 명시적 null 로 둔다 — 회전이 활성화되는 날
     * 필드의 유무가 아니라 값만 달라지게 하기 위해서다. 필드가 사라지면 앱의 {@code if (refreshToken)}
     * 분기는 같은데, 계약 문서와 실제 응답이 조용히 어긋난다.
     */
    @Test
    @DisplayName("회전하지 않는 갱신은 refreshToken 필드를 null 로 «남겨» 둔다")
    void keepsTheRefreshTokenFieldPresentAndNullWhenNotRotating() throws Exception {
        mockMvc.perform(refresh("valid-refresh-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.refreshToken").doesNotExist())
                .andExpect(jsonPath("$.data.accessToken").value("fresh-at"));
    }

    /** 상류가 회전을 시작하면 그 값을 <b>그대로</b> 싣는다 — 여기서 null 로 만들면 앱이 죽은 RT 를 쥔다. */
    @Test
    @DisplayName("상류가 회전된 RT 를 주면 그 값을 그대로 내보낸다")
    void relaysARotatedRefreshTokenInsteadOfBlankingIt() throws Exception {
        DATA.on(DATA_REFRESH, request -> ok("{\"accessToken\":\"fresh-at\",\"refreshToken\":\"rotated-rt\"}"));

        mockMvc.perform(refresh("valid-refresh-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.refreshToken").value("rotated-rt"));
    }

    // ── DoD ② 자격은 저장소·공용 캐시에 남지 않는다 ──────────────────────────────

    /** 토큰 응답은 {@code Cache-Control: no-store} 다 (계정 LLD §1 「공용 캐시 금지」). */
    @Test
    @DisplayName("갱신 응답은 성공·실패 모두 no-store 다")
    void neverAllowsATokenResponseToBeCached() throws Exception {
        mockMvc.perform(refresh("valid-refresh-token"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"));

        DATA.on(DATA_REFRESH, request -> error(401, "REFRESH_TOKEN"));
        mockMvc.perform(refresh("dead-refresh-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    /**
     * 상류에 나가는 것은 RT <b>하나뿐</b>이다.
     *
     * <p>{@code sessionId}·{@code deviceBootstrap} 처럼 기기 등록 축의 자격이 갱신 요청·응답에
     * 섞여 들어오면, 공개 표면이 그것을 다시 내보내는 사고가 한 줄 차이로 가능해진다.
     */
    @Test
    @DisplayName("상류 요청 본문은 refreshToken 한 필드다")
    void sendsNothingButTheRefreshTokenUpstream() throws Exception {
        mockMvc.perform(refresh("valid-refresh-token")).andExpect(status().isOk());

        assertThat(DATA.receivedFor(DATA_REFRESH)).singleElement()
                .extracting(MockUpstream.RecordedRequest::body)
                .isEqualTo("{\"refreshToken\":\"valid-refresh-token\"}");
    }

    // ── DoD ③ 만료·위조·이미 교체된 RT 는 각각 거절된다 ──────────────────────────

    /**
     * 셋 다 같은 401 {@code REFRESH_TOKEN} 이다 (계정 LLD §3 표 1·4행).
     *
     * <p>원인을 코드로 쪼개지 않는 것이 계약이다 — 「어느 검증에서 걸렸는가」를 알려 주지 않고,
     * 앱의 답은 어느 쪽이든 재로그인으로 같다. 세 경우를 <b>따로</b> 거는 이유는 구현이 하나만
     * 처리하고 나머지를 500 으로 흘리는 회귀를 잡기 위해서다.
     */
    @ParameterizedTest(name = "{0} RT → 401 REFRESH_TOKEN")
    @ValueSource(strings = {"expired", "forged", "already-rotated"})
    void rejectsExpiredForgedAndAlreadyRotatedRefreshTokens(String kind) throws Exception {
        DATA.on(DATA_REFRESH, request -> error(401, "REFRESH_TOKEN"));

        mockMvc.perform(refresh(kind + "-refresh-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("REFRESH_TOKEN"))
                .andExpect(jsonPath("$.error.retryable").value(false))
                .andExpect(jsonPath("$.error.field").doesNotExist())
                .andExpect(jsonPath("$.requestId").isNotEmpty())
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    /** 탈퇴·비활성 계정은 RT 거절과 <b>구분해서</b> 내보낸다 — 앱의 안내 문구가 다르다. */
    @Test
    @DisplayName("탈퇴한 계정의 갱신은 USER_NOT_FOUND 404 다")
    void separatesAWithdrawnAccountFromARejectedToken() throws Exception {
        DATA.on(DATA_REFRESH, request -> error(404, "USER_NOT_FOUND"));

        mockMvc.perform(refresh("refresh-of-withdrawn-user"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("USER_NOT_FOUND"));
    }

    /** AT 없는 200 을 그대로 내보내지 않는다 — 앱이 빈 값을 저장하고 다음 요청에서 401 을 맞는다. */
    @ParameterizedTest
    @ValueSource(strings = {
        "{\"accessToken\":null,\"refreshToken\":null}",
        "{\"accessToken\":\"\",\"refreshToken\":null}",
        "{\"refreshToken\":null}",
    })
    void rejectsUpstreamResultMissingTheAccessToken(String body) throws Exception {
        DATA.on(DATA_REFRESH, request -> ok(body));

        mockMvc.perform(refresh("valid-refresh-token"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    // ── DoD ④ 자격의 «모양» 을 좁힌다 ────────────────────────────────────────────

    /** RT 헤더 자체가 없으면 401 이다 — 자격 없는 요청이지 형식 오류가 아니다. */
    @Test
    @DisplayName("X-Refresh-Token 이 없으면 401 REFRESH_TOKEN 이다")
    void rejectsARequestWithoutTheRefreshHeader() throws Exception {
        mockMvc.perform(post(PATH))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("REFRESH_TOKEN"));
    }

    /**
     * 헤더가 둘이거나 값이 비정상이면 401 이다.
     *
     * <p>둘을 허용하면 프록시 단계마다 다른 값을 고를 수 있어 「어느 세션의 갱신인가」가 경유 경로에
     * 따라 갈린다 — {@code LogoutCredentials} 와 같은 규율이다.
     */
    @Test
    @DisplayName("X-Refresh-Token 이 둘이면 401 이다")
    void rejectsDuplicateRefreshHeaders() throws Exception {
        mockMvc.perform(post(PATH)
                        .header("X-Refresh-Token", "first-token")
                        .header("X-Refresh-Token", "second-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("REFRESH_TOKEN"));
    }

    /** 본문·쿼리를 받지 않는다 — 계약이 헤더와 본문 두 곳으로 갈리지 않게. */
    @ParameterizedTest
    @CsvSource(value = {"?anything=1,", ",{}"}, emptyValue = "")
    void rejectsAQueryStringOrABody(String query, String body) throws Exception {
        MockHttpServletRequestBuilder request = post(PATH + (query == null ? "" : query))
                .header("X-Refresh-Token", "valid-refresh-token");
        if (body != null && !body.isEmpty()) {
            request = request.contentType(MediaType.APPLICATION_JSON).content(body);
        }

        mockMvc.perform(request)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private static MockHttpServletRequestBuilder refresh(String refreshToken) {
        return post(PATH).header("X-Refresh-Token", refreshToken);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
