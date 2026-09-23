package com.oneorthree.business.api;

import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 게스트 시작 공개 계약 (GROMO-2036) — 실제 필터 체인 · 컨트롤러 · HTTP 로 확인한다.
 *
 * <h2>이 테스트가 «깨지도록» 만든 것</h2>
 * 상류를 고정 응답으로 두면 「같은 기기가 같은 계정을 받았는가」를 검증할 수 없다 — 어느 쪽이든 같은
 * 201 이 오기 때문이다. 그래서 {@link #ledger} 가 <b>진짜 점유 원장처럼</b> digest → userId 를 들고
 * 있다. 구현이 digest 를 계산하지 않거나 기기마다 다른 값을 만들면 두 요청의 userId 가 갈려 실패한다.
 */
class GuestSessionContractTest extends UpstreamTestBase {

    private static final String PATH = "/auth/sessions/guest";
    private static final String DATA_GUEST = "POST /internal/auth/guest-sessions";

    private static final String DEVICE_A = "dddddddd-0000-7000-8000-000000002036";
    private static final String DEVICE_B = "dddddddd-0000-7000-8000-000000002037";
    private static final UUID EXISTING = UUID.fromString("aaaaaaaa-0000-0000-0000-000000002036");

    /** deviceDigest → 그 기기가 받은 userId. 실제 {@code guest_device_claims} 가 하는 일의 최소판이다. */
    private final Map<String, UUID> ledger = new HashMap<>();

    @BeforeEach
    void stubLedger() {
        ledger.clear();
        DATA.on(DATA_GUEST, request -> {
            String digest = field(request.body(), "deviceDigest");
            UUID userId = ledger.computeIfAbsent(digest, key -> UUID.randomUUID());
            return ok("{\"accessToken\":\"at-" + userId + "\",\"refreshToken\":\"rt-" + userId
                    + "\",\"userId\":\"" + userId + "\",\"onboardingComplete\":false}");
        });
    }

    // ── DoD ① 응답은 소셜 로그인과 같은 201 네 필드다 ────────────────────────────

    /**
     * 앱의 세션 저장 코드가 로그인이든 게스트든 한 갈래로 끝나려면 <b>모양이 같아야</b> 한다.
     *
     * <p>상류가 {@code sessionId}·{@code deviceBootstrap} 을 실어 보내도 <b>본문</b>으로는 나가면
     * 안 되므로 둘을 «실어» 두고 공개 본문에서 사라지는지 본다. 필드 개수까지 세는 이유는 「있으면
     * 안 되는 것」을 이름으로 하나씩 적으면 새로 생긴 필드를 영영 못 잡기 때문이다.
     *
     * <p>{@code deviceBootstrap} 은 사라지는 것이 아니라 {@code X-Device-Bootstrap} <b>헤더</b>로
     * 옮겨 간다(GROMO-2037 · 계정 LLD §2.1). 본문에서 빠졌다는 단언만 두면 「그냥 버려도」 통과하니
     * 헤더에 그 값이 있다는 것까지 여기서 함께 고정한다 — 자세한 계약은
     * {@code DeviceBootstrapHeaderContractTest}.
     */
    @Test
    @DisplayName("201 은 소셜 로그인과 같은 네 필드이고 세션 자격을 흘리지 않는다")
    void returnsExactlyFourFieldsAndLeaksNoSessionCredential() throws Exception {
        DATA.on(DATA_GUEST, request -> ok("{\"accessToken\":\"at\",\"refreshToken\":\"rt\","
                + "\"userId\":\"" + EXISTING + "\",\"onboardingComplete\":false,"
                + "\"sessionId\":\"" + UUID.randomUUID() + "\",\"deviceBootstrap\":\"one-shot\","
                + "\"isNewUser\":true}"));

        mockMvc.perform(guest(DEVICE_A))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.accessToken").value("at"))
                .andExpect(jsonPath("$.data.refreshToken").value("rt"))
                .andExpect(jsonPath("$.data.userId").value(EXISTING.toString()))
                .andExpect(jsonPath("$.data.onboardingComplete").value(false))
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data.sessionId").doesNotExist())
                .andExpect(jsonPath("$.data.deviceBootstrap").doesNotExist())
                .andExpect(jsonPath("$.data.isNewUser").doesNotExist())
                .andExpect(header().string("X-Device-Bootstrap", "one-shot"));
    }

    /** 토큰이 빠진 상류 응답을 201 로 접지 않는다 — 앱이 「시작됐다」고 믿고 다음 요청에서 401 을 맞는다. */
    @ParameterizedTest
    @ValueSource(strings = {
        "{\"accessToken\":null,\"refreshToken\":\"rt\",\"userId\":\"%s\",\"onboardingComplete\":false}",
        "{\"accessToken\":\"at\",\"refreshToken\":null,\"userId\":\"%s\",\"onboardingComplete\":false}",
        "{\"accessToken\":\"at\",\"refreshToken\":\"rt\",\"userId\":null,\"onboardingComplete\":false}",
    })
    void rejectsUpstreamResultMissingAnyCredential(String template) throws Exception {
        DATA.on(DATA_GUEST, request -> ok(template.formatted(EXISTING)));

        mockMvc.perform(guest(DEVICE_A))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    // ── DoD ② 같은 기기의 재시도는 같은 계정이다 ────────────────────────────────

    /**
     * <b>이 테스트의 핵심 단언은 두 응답의 {@code userId} 가 같다는 것이다.</b>
     *
     * <p>유실된 201 의 재시도가 계정을 둘 만들면 사용자는 고양이·섬·집중 기록을 잃고, 앱이 모르는
     * 계정이 하나 남는다. 원장 stub 이 digest 로만 판정하므로, 구현이 digest 를 계산하지 않거나
     * 요청마다 다른 값을 만들면 여기서 갈려 실패한다.
     */
    @Test
    @DisplayName("같은 기기 식별자의 재시도는 같은 userId 를 받는다")
    void givesTheSameAccountBackWhenTheSameDeviceRetries() throws Exception {
        String first = mockMvc.perform(guest(DEVICE_A)).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String second = mockMvc.perform(guest(DEVICE_A)).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        assertThat(first).isEqualTo(second);
        assertThat(ledger).hasSize(1);
    }

    /** 다른 기기는 다른 계정이다 — 멱등 키가 기기 축이라는 것의 반대편 단언이다. */
    @Test
    @DisplayName("다른 기기 식별자는 다른 계정을 받는다")
    void givesADifferentAccountToADifferentDevice() throws Exception {
        mockMvc.perform(guest(DEVICE_A)).andExpect(status().isCreated());
        mockMvc.perform(guest(DEVICE_B)).andExpect(status().isCreated());

        assertThat(ledger).hasSize(2);
        assertThat(ledger.values()).doesNotHaveDuplicates();
    }

    // ── DoD ③ 기기 식별자 원문과 자격은 밖으로 새지 않는다 ──────────────────────

    /**
     * 상류에 나가는 것은 <b>digest</b> 다 — 원 기기 식별자가 아니다 (계정 LLD §3).
     *
     * <p>원문을 그대로 넘기면 Data 의 원장이 기기 식별자를 평문으로 보관하게 되고, 그 표가 유출되면
     * 복구 창 안의 게스트 계정을 그대로 열 수 있다.
     */
    @Test
    @DisplayName("상류에는 기기 식별자 원문이 아니라 digest 가 나간다")
    void sendsADigestUpstreamAndNeverTheRawDeviceIdentifier() throws Exception {
        mockMvc.perform(guest(DEVICE_A)).andExpect(status().isCreated());

        String body = DATA.receivedFor(DATA_GUEST).get(0).body();
        assertThat(body).doesNotContain(DEVICE_A);
        assertThat(field(body, "deviceDigest")).hasSize(64).matches("[0-9a-f]{64}");
        // 레이트리밋 축 — 이 값이 빠지면 Data 는 내부 호출의 소스 IP 를 보게 되고, 모든 게스트가
        // Business 컨테이너 한 주소로 뭉쳐 한도가 「전원 차단」으로 동작한다.
        assertThat(field(body, "clientIp")).isNotBlank();
    }

    /** 토큰 응답은 {@code Cache-Control: no-store} 다 (계정 LLD §1 「공용 캐시 금지」). */
    @Test
    @DisplayName("게스트 발급 응답은 성공·실패 모두 no-store 다")
    void neverAllowsATokenResponseToBeCached() throws Exception {
        mockMvc.perform(guest(DEVICE_A))
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"));

        DATA.on(DATA_GUEST, request -> error(429, "GUEST_CREATION_RATE_LIMITED"));
        mockMvc.perform(guest(DEVICE_B))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    /** 대량 생성 차단은 Data 의 축이고, 공개 표면은 그 429 를 <b>재시도 가능</b>으로 전한다. */
    @Test
    @DisplayName("게스트 생성 레이트리밋은 429 RATE_LIMITED 로 나간다")
    void relaysTheGuestCreationRateLimit() throws Exception {
        DATA.on(DATA_GUEST, request -> error(429, "GUEST_CREATION_RATE_LIMITED"));

        mockMvc.perform(guest(DEVICE_A))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.retryable").value(true));
    }

    // ── DoD ④ 자격·멱등 키의 «모양» ─────────────────────────────────────────────

    /**
     * {@code X-Device-Id} 는 하이픈 포함 36자 UUID 만 받는다.
     *
     * <p>{@code UUID.fromString} 은 {@code "1-2-3-4-5"} 같은 짧은 문자열도 받아들이므로, 길이·왕복
     * 검사를 빼면 <b>같은 기기가 두 표기로 갈려 계정이 둘</b> 생긴다 — 이 경로에서 그건 곧 계정 유실이다.
     */
    @ParameterizedTest(name = "잘못된 기기 식별자 [{0}] → 400")
    @ValueSource(strings = {
        "1-2-3-4-5",
        "dddddddd00007000800000000000203 6",
        "dddddddd-0000-7000-8000-00000000203",
        "not-a-uuid-at-all-not-a-uuid-at-all!",
    })
    void rejectsADeviceIdentifierThatIsNotACanonicalUuid(String deviceId) throws Exception {
        mockMvc.perform(post(PATH).header("X-Device-Id", deviceId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.error.field").value("X-Device-Id"));

        assertThat(DATA.hits(DATA_GUEST)).as("형식 오류는 상류에 닿지 않는다").isZero();
    }

    /** 헤더가 둘이면 경유 경로마다 다른 기기로 보여 멱등이 무너진다. */
    @Test
    @DisplayName("X-Device-Id 가 둘이면 400 이다")
    void rejectsDuplicateDeviceHeaders() throws Exception {
        mockMvc.perform(post(PATH).header("X-Device-Id", DEVICE_A).header("X-Device-Id", DEVICE_B))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }

    @Test
    @DisplayName("X-Device-Id 가 없으면 400 이다")
    void rejectsARequestWithoutADeviceIdentifier() throws Exception {
        mockMvc.perform(post(PATH))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("X-Device-Id"));
    }

    /**
     * AT 를 실었다면 유효해야 한다 (계정 LLD §2.1).
     *
     * <p>강등해서 통과시키면 폐기된 세션의 AT 를 든 요청이 「AT 없는 새 게스트 시작」으로 지나간다.
     * {@link SessionRefreshController} 의 갱신 경로와 <b>다른</b> 규칙인 이유는, 게스트 시작에는
     * 「AT 가 만료된 것이 정상」인 상황이 없기 때문이다.
     */
    @Test
    @DisplayName("잘못된 AT 를 실으면 401 — 익명 시작으로 강등하지 않는다")
    void neverSilentlyDowngradesABadAccessTokenToAnAnonymousStart() throws Exception {
        mockMvc.perform(guest(DEVICE_A).header("Authorization", "Bearer " + Tokens.expired(EXISTING)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));

        assertThat(DATA.hits(DATA_GUEST)).as("거절된 요청은 상류에 닿지 않는다").isZero();
    }

    /** 유효한 AT 는 그대로 통과한다 — 게스트 시작을 막을 이유가 없다(승격은 티켓 1992 의 축이다). */
    @Test
    @DisplayName("유효한 AT 를 실은 게스트 시작은 통과한다")
    void allowsAValidAccessTokenToAccompanyTheRequest() throws Exception {
        mockMvc.perform(guest(DEVICE_A).header("Authorization", "Bearer " + Tokens.access(EXISTING)))
                .andExpect(status().isCreated());
    }

    /** 본문·쿼리를 받지 않는다 — 자격도 멱등 키도 전부 헤더다. */
    @Test
    @DisplayName("본문이나 쿼리를 실으면 400 이다")
    void rejectsAQueryStringOrABody() throws Exception {
        mockMvc.perform(post(PATH + "?anything=1").header("X-Device-Id", DEVICE_A))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));

        mockMvc.perform(post(PATH).header("X-Device-Id", DEVICE_A)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private static MockHttpServletRequestBuilder guest(String deviceId) {
        return post(PATH).header("X-Device-Id", deviceId);
    }

    /** 평평한 JSON 본문에서 문자열 필드 하나를 꺼낸다 — mock 상류가 판정에 쓸 최소한의 파싱. */
    private static String field(String body, String name) {
        String marker = "\"" + name + "\":\"";
        int start = body.indexOf(marker);
        if (start < 0) {
            return null;
        }
        start += marker.length();
        return body.substring(start, body.indexOf('"', start));
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
