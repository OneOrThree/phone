package com.oneorthree.business.api;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code X-Device-Bootstrap} 응답 헤더 계약 (GROMO-2037 · 계정 LLD §2.1).
 *
 * <p>LLD §2.1: 「기존 {@code deviceBootstrap} 전달은 신규 응답의 {@code X-Device-Bootstrap} 헤더로
 * 보존한다(기술 결정). … <b>본문 4필드는 유지</b>하며 헤더도 자격이므로 저장소/로그/공용 캐시에
 * 노출하지 않는다.」 그래서 이 클래스가 세 가지를 한꺼번에 고정한다 — 헤더에 <b>있고</b>, 본문에
 * <b>없고</b>, 로그·공용 캐시에 <b>남지 않는다</b>.
 *
 * <h2>값을 눈에 띄는 문자열로 둔 이유</h2>
 * {@link #BOOTSTRAP} 는 다른 어떤 필드와도 겹치지 않는 문자열이다. 로그 단언이 「응답 본문 어딘가에
 * 우연히 들어 있는 짧은 토큰」을 잡아 통과/실패하지 않게 하려는 것이다.
 */
class DeviceBootstrapHeaderContractTest extends UpstreamTestBase {

    private static final String LOGIN_PATH = "/auth/sessions";
    private static final String GUEST_PATH = "/auth/sessions/guest";
    private static final String DATA_LOOKUP = "POST /internal/auth/login-attempts/lookup";
    private static final String DATA_EXECUTE = "POST /internal/auth/login-attempts";
    private static final String DATA_GUEST = "POST /internal/auth/guest-sessions";

    private static final UUID USER = UUID.fromString("aaaaaaaa-0000-0000-0000-000000002037");
    private static final String ATTEMPT = "cccccccc-0000-7000-8000-000000002037";
    private static final String DEVICE = "dddddddd-0000-7000-8000-000000002037";

    /** 1회용 자격 원문. 어떤 토큰·id 와도 안 겹치는 값이라 로그 검사가 정확히 이것만 본다. */
    private static final String BOOTSTRAP = "one-shot-bootstrap-2037-do-not-log";

    private static final String BODY = """
            {"provider":"apple","credential":{"type":"id_token","value":"apple-identity-token"},\
            "termsVersion":"2026-09"}""";

    // ── 헤더에 있다 · 본문에 없다 ────────────────────────────────────────────────

    /**
     * 상류가 준 값이 <b>그대로</b> 헤더로 나가고 본문에는 없다.
     *
     * <p>「헤더가 있다」만 보면 안 된다 — 값이 상류가 준 것과 다르면 앱은 자격을 «받았다»고 믿고
     * 기기 등록에 실어 보내는데, 알림 서버의 세션 fence 는 그 값의 SHA-256 으로 서므로 아무 기기도
     * 자기 세션에 붙지 못한다. 그래서 문자열 일치까지 단언한다.
     */
    @Test
    @DisplayName("소셜 로그인 201 은 상류가 준 자격을 헤더로 싣고 본문에는 싣지 않는다")
    void carriesUpstreamBootstrapInHeaderAndNeverInBody() throws Exception {
        stubLogin(BOOTSTRAP);

        String body = mockMvc.perform(login())
                .andExpect(status().isCreated())
                .andExpect(header().string("X-Device-Bootstrap", BOOTSTRAP))
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data.accessToken").value("at"))
                .andExpect(jsonPath("$.data.deviceBootstrap").doesNotExist())
                .andReturn().getResponse().getContentAsString();

        // jsonPath 는 «그 이름의» 필드만 본다. 값이 다른 이름으로 새 나가는 경우까지 잡으려면
        // 본문 전체를 봐야 한다 — 봉투가 바뀌어도 이 단언은 계속 참이어야 한다.
        assertThat(body).doesNotContain(BOOTSTRAP);
    }

    /** 게스트도 같은 자격 축이다 — 여기서 빠지면 게스트만 「자격 없이 수락」 경로로 남는다. */
    @Test
    @DisplayName("게스트 시작 201 도 같은 헤더로 자격을 싣는다")
    void carriesBootstrapOnGuestStart() throws Exception {
        DATA.on(DATA_GUEST, request -> ok(session("at", "rt", BOOTSTRAP)));

        String body = mockMvc.perform(guest())
                .andExpect(status().isCreated())
                .andExpect(header().string("X-Device-Bootstrap", BOOTSTRAP))
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data.deviceBootstrap").doesNotExist())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain(BOOTSTRAP);
    }

    // ── 자격은 캐시에 남지 않는다 ───────────────────────────────────────────────

    /**
     * 자격을 실은 응답은 공용 캐시에 들어가면 안 된다 (LLD §1 「토큰·개인 계정·설정 응답은
     * {@code Cache-Control: no-store}. 공용 캐시 금지」).
     *
     * <p>{@code RequestEnvelopeFilter} 가 모든 공개 응답에 붙이므로 지금은 자동으로 참이다. 그래도
     * <b>이 경로에서</b> 고정해 둔다 — 그 필터의 범위가 좁아지는 날, 헤더로 자격을 내보내는 응답이
     * 캐시 가능해졌다는 사실을 아무도 모른 채 배포된다.
     */
    @Test
    @DisplayName("자격을 실은 201 은 no-store 다")
    void bootstrapResponseIsNeverCacheable() throws Exception {
        stubLogin(BOOTSTRAP);

        mockMvc.perform(login())
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    // ── 자격은 로그에 남지 않는다 ───────────────────────────────────────────────

    /**
     * 로그인 한 번이 남긴 <b>모든</b> 로그 이벤트에 자격이 없어야 한다.
     *
     * <p>특정 로거만 보지 않고 root 에 붙인다 — 상류 클라이언트·MVC·필터 중 어디가 본문이나 헤더를
     * 찍기 시작해도 걸린다. 자격은 이제 Data→Business 내부 응답 <b>본문</b>으로 흐르므로, 상류 응답을
     * 통째로 찍는 디버그 로그가 하나 들어오는 순간이 곧 유출이다.
     */
    @Test
    @DisplayName("로그인 경로의 어떤 로그에도 자격이 찍히지 않는다")
    void neverLogsTheBootstrapCredential() throws Exception {
        stubLogin(BOOTSTRAP);
        Logger root = (Logger) LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        root.addAppender(appender);
        try {
            mockMvc.perform(login()).andExpect(status().isCreated());
        } finally {
            root.detachAppender(appender);
            appender.stop();
        }

        // 아무것도 안 찍혔으면 이 단언은 공짜로 통과한다 — 그러면 검사 자체가 무의미하니
        // 「실제로 로그가 돈다」를 먼저 고정한다(business_request 접근 로그가 매 요청 하나 남는다).
        assertThat(appender.list).isNotEmpty();
        assertThat(appender.list).extracting(ILoggingEvent::getFormattedMessage)
                .noneMatch(message -> message.contains(BOOTSTRAP));
    }

    // ── 값이 없으면 헤더도 없다 ─────────────────────────────────────────────────

    /**
     * 상류가 자격을 안 주면(결과 재생 · 빈 값) 헤더를 <b>아예 빼야</b> 한다.
     *
     * <p>빈 헤더를 실으면 앱은 「자격을 받았다」고 믿고 빈 문자열을 기기 등록에 보낸다. 알림 서버는
     * 그 값의 SHA-256 으로 세션 fence 를 만드니 <b>모든 기기가 같은 fence</b> 를 공유하게 되고, 한
     * 기기의 세션 폐기가 남의 기기를 끊는다. 헤더가 없으면 앱은 기존 자격 없는 등록 경로로 내려간다.
     *
     * <p>결과 재생(응답 유실 복구)이 이 분기의 실제 사례다 — 자격 원문은 발급 1회만 존재하고 어디에도
     * 저장하지 않으므로 상류가 되살리지 못한다.
     */
    @ParameterizedTest(name = "[{index}] upstream deviceBootstrap={0}")
    @ValueSource(strings = {"null", "\"\"", "\"   \""})
    @DisplayName("상류가 자격을 주지 않으면 헤더를 싣지 않는다")
    void omitsHeaderWhenUpstreamHasNoCredential(String json) throws Exception {
        DATA.on(DATA_LOOKUP, request -> ok("{\"replayable\":false,\"session\":null}"));
        DATA.on(DATA_EXECUTE, request -> ok("{\"accessToken\":\"at\",\"refreshToken\":\"rt\","
                + "\"userId\":\"" + USER + "\",\"onboardingComplete\":false,"
                + "\"deviceBootstrap\":" + json + "}"));

        mockMvc.perform(login())
                .andExpect(status().isCreated())
                .andExpect(header().doesNotExist("X-Device-Bootstrap"))
                .andExpect(jsonPath("$.data.length()").value(4));
    }

    /** 자격이 없어도 로그인 자체는 성공한다 — 없는 자격을 502 로 올리면 재생이 통째로 막힌다. */
    @Test
    @DisplayName("재생 응답은 자격 없이도 201 이다")
    void replayWithoutCredentialStillSucceeds() throws Exception {
        DATA.on(DATA_LOOKUP, request ->
                ok("{\"replayable\":true,\"session\":" + session("at", "rt", null) + "}"));

        mockMvc.perform(login())
                .andExpect(status().isCreated())
                .andExpect(header().doesNotExist("X-Device-Bootstrap"))
                .andExpect(jsonPath("$.data.accessToken").value("at"));
        assertThat(DATA.hits(DATA_EXECUTE)).isZero();
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private void stubLogin(String bootstrap) {
        DATA.on(DATA_LOOKUP, request -> ok("{\"replayable\":false,\"session\":null}"));
        DATA.on(DATA_EXECUTE, request -> ok(session("at", "rt", bootstrap)));
    }

    private MockHttpServletRequestBuilder login() {
        return post(LOGIN_PATH).contentType(MediaType.APPLICATION_JSON).content(BODY)
                .header("X-Login-Attempt-Id", ATTEMPT);
    }

    private MockHttpServletRequestBuilder guest() {
        return post(GUEST_PATH).header("X-Device-Id", DEVICE);
    }

    private static String session(String accessToken, String refreshToken, String bootstrap) {
        return "{\"accessToken\":\"" + accessToken + "\",\"refreshToken\":\"" + refreshToken
                + "\",\"userId\":\"" + USER + "\",\"onboardingComplete\":false,\"deviceBootstrap\":"
                + (bootstrap == null ? "null" : "\"" + bootstrap + "\"") + "}";
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }
}
