package com.oneorthree.business.config;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.business.common.api.ApiResponses;
import com.oneorthree.business.common.logging.ObservationJsonProvider;
import io.micrometer.core.instrument.Tag;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 RequestEnvelopeFilter + 실제 MVC 경로 매칭으로 접근 로그 JSON 필드를 본다. */
class RequestEnvelopeAccessLogTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObservationJsonProvider PROVIDER = new ObservationJsonProvider(new MockEnvironment());

    // 필드 선언 순서가 생성 순서다 — filter 가 metrics 를 쓰므로 위에 둔다(전방 참조 금지).
    private final SimpleMeterRegistry metrics = new SimpleMeterRegistry();
    private final RequestEnvelopeFilter filter = new RequestEnvelopeFilter(new ApiResponses(new JsonMapper()), metrics);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new ProbeController()).addFilters(filter).build();
    private final Logger logger = (Logger) LoggerFactory.getLogger(RequestEnvelopeFilter.class);
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

    @BeforeEach
    void attach() {
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void detach() {
        logger.detachAppender(appender);
        appender.stop();
    }

    @Test
    void completedRequestCarriesRouteStatusAndDuration() throws Exception {
        String requestId = mockMvc.perform(get("/probe/42?email=user@example.com"))
                .andExpect(status().isOk()).andReturn().getResponse().getHeader("X-Request-Id");

        Map<String, Object> json = accessJson();
        assertThat(json).containsEntry("log_kind", "access").containsEntry("http_method", "GET")
                .containsEntry("http_route", "/probe/{id}").containsEntry("status_code", 200)
                .containsEntry("outcome", "completed").containsEntry("request_id", requestId)
                .containsEntry("message", "business_request method=GET status=200 duration_ms=" + json.get("duration_ms"));
        assertThat((Integer) json.get("duration_ms")).isGreaterThanOrEqualTo(0);
        assertThat(json.toString()).doesNotContain("user@example.com");
    }

    @Test
    void validAppHeadersAreLogged() throws Exception {
        mockMvc.perform(get("/probe/1").header("X-App-Version", "1.0.2").header("X-App-Platform", "ios"))
                .andExpect(status().isOk());

        assertThat(accessJson()).containsEntry("app_version", "1.0.2").containsEntry("app_platform", "ios");
        assertThat(metrics.getMeters()).as("유효한 값은 세지 않는다").isEmpty();
    }

    @Test
    void paddedVersionIsStrippedAndAccepted() throws Exception {
        mockMvc.perform(get("/probe/1").header("X-App-Version", "2.0.1 ").header("X-App-Platform", "android"))
                .andExpect(status().isOk());

        assertThat(accessJson()).containsEntry("app_version", "2.0.1").containsEntry("app_platform", "android");
    }

    @Test
    void missingAppHeadersOmitKeys() throws Exception {
        mockMvc.perform(get("/probe/1")).andExpect(status().isOk());

        assertThat(accessJson()).doesNotContainKeys("app_version", "app_platform");
    }

    @Test
    void invalidAppHeadersAreDroppedWithoutRejectingRequest() throws Exception {
        for (String version : new String[] {"1.0", "v1.0.2", "1.0.2\nforged=1", "1.0.2.3", "1234567890.0.0",
                "9".repeat(5000)}) {
            for (String platform : new String[] {"IOS", "web", "ios\nforged=1", "a".repeat(5000)}) {
                appender.list.clear();
                mockMvc.perform(get("/probe/1").header("X-App-Version", version).header("X-App-Platform", platform))
                        .andExpect(status().isOk());

                // 포맷터가 아니라 이벤트 자체에서 키가 없어야 필터 쪽 검증이 증명된다.
                assertThat(keysOf(accessEvent())).doesNotContain("app_version", "app_platform");
                assertThat(accessJson()).containsEntry("status_code", 200)
                        .doesNotContainKeys("app_version", "app_platform");
            }
        }
    }

    @Test
    void validAppHeadersAreKeyValuesOfTheEvent() throws Exception {
        mockMvc.perform(get("/probe/1").header("X-App-Version", " 2.0.1 ").header("X-App-Platform", "android"))
                .andExpect(status().isOk());

        assertThat(accessEvent().getKeyValuePairs()).extracting(kv -> kv.key, kv -> kv.value)
                .contains(org.assertj.core.groups.Tuple.tuple("app_version", "2.0.1"),
                        org.assertj.core.groups.Tuple.tuple("app_platform", "android"));
    }

    @Test
    void invalidVersionDoesNotDropValidPlatform() throws Exception {
        mockMvc.perform(get("/probe/1").header("X-App-Version", "1.0").header("X-App-Platform", "ios"))
                .andExpect(status().isOk());

        assertThat(keysOf(accessEvent())).contains("app_platform").doesNotContain("app_version");
        assertThat(accessJson()).containsEntry("app_platform", "ios").doesNotContainKey("app_version");
    }

    @Test
    void invalidPlatformDoesNotDropValidVersion() throws Exception {
        mockMvc.perform(get("/probe/1").header("X-App-Version", "1.0.2").header("X-App-Platform", "web"))
                .andExpect(status().isOk());

        assertThat(keysOf(accessEvent())).contains("app_version").doesNotContain("app_platform");
        assertThat(accessJson()).containsEntry("app_version", "1.0.2").doesNotContainKey("app_platform");
    }

    @Test
    void paddedAppHeadersAreStrippedBeforeLoggingAndNotCounted() throws Exception {
        mockMvc.perform(get("/probe/1").header("X-App-Version", " 2.0.1 ").header("X-App-Platform", " ios "))
                .andExpect(status().isOk());

        assertThat(accessEvent().getKeyValuePairs()).extracting(kv -> kv.key, kv -> kv.value)
                .contains(tuple("app_version", "2.0.1"), tuple("app_platform", "ios"));
        assertThat(accessJson()).containsEntry("app_version", "2.0.1").containsEntry("app_platform", "ios");
        assertThat(metrics.getMeters()).as("공백을 걷어 내면 유효한 값이다").isEmpty();
    }

    @Test
    void invalidVersionIsCountedUnderItsOwnHeader() throws Exception {
        mockMvc.perform(get("/probe/1").header("X-App-Version", "1.0").header("X-App-Platform", "ios"))
                .andExpect(status().isOk());

        assertThat(invalid("X-App-Version")).isEqualTo(1);
        assertThat(invalid("X-App-Platform")).isZero();
    }

    @Test
    void invalidPlatformIsCountedUnderItsOwnHeader() throws Exception {
        // IOS 는 대소문자까지 정확해야 하는 값이라 여전히 무효다 — 공백만 걷는다.
        mockMvc.perform(get("/probe/1").header("X-App-Version", "1.0.2").header("X-App-Platform", "IOS"))
                .andExpect(status().isOk());

        assertThat(invalid("X-App-Platform")).isEqualTo(1);
        assertThat(invalid("X-App-Version")).isZero();
    }

    @Test
    void bothInvalidCountTwoAndTagsCarryOnlyTheHeaderName() throws Exception {
        mockMvc.perform(get("/probe/1").header("X-App-Version", "v9.9").header("X-App-Platform", "web"))
                .andExpect(status().isOk());

        assertThat(invalid("X-App-Version") + invalid("X-App-Platform")).isEqualTo(2);
        // 이름·태그 집합이 전부다 — 원본 값(v9.9·web)은 태그에 실리지 않는다.
        assertThat(metrics.getMeters()).hasSize(2).extracting(meter -> meter.getId().getName())
                .containsOnly("business.request.app_header.invalid");
        assertThat(metrics.getMeters()).flatExtracting(meter -> meter.getId().getTags())
                .extracting(Tag::getKey, Tag::getValue)
                .containsExactlyInAnyOrder(tuple("header", "X-App-Version"), tuple("header", "X-App-Platform"));
    }

    @Test
    void missingOrBlankAppHeadersAreAbsentNotCounted() throws Exception {
        mockMvc.perform(get("/probe/1")).andExpect(status().isOk());
        mockMvc.perform(get("/probe/1").header("X-App-Version", "").header("X-App-Platform", ""))
                .andExpect(status().isOk());
        mockMvc.perform(get("/probe/1").header("X-App-Version", "  ").header("X-App-Platform", " \t "))
                .andExpect(status().isOk());

        assertThat(metrics.getMeters()).isEmpty();
        assertThat(keysOf(accessEvent())).doesNotContain("app_version", "app_platform");
    }

    @Test
    void unhandledExceptionOmitsUndecidedStatus() {
        assertThatThrownBy(() -> mockMvc.perform(get("/boom"))).hasRootCauseMessage("boom");

        Map<String, Object> json = accessJson();
        assertThat(json).containsEntry("log_kind", "access").containsEntry("http_route", "/boom")
                .containsEntry("outcome", "unhandled_exception").doesNotContainKey("status_code");
        assertThat((String) json.get("message")).contains("status=unhandled_exception");
    }

    @Test
    void declaredOversizeBodyIsRejectedBeforeRouting() throws Exception {
        mockMvc.perform(post("/probe/1").header("X-App-Version", "1.0.2").header("X-App-Platform", "ios")
                .content(new byte[RequestEnvelopeFilter.MAX_BODY + 1])).andExpect(status().isPayloadTooLarge());

        assertThat(accessJson()).containsEntry("http_method", "POST").containsEntry("http_route", "unmatched")
                .containsEntry("status_code", 413).containsEntry("outcome", "completed")
                .containsEntry("app_version", "1.0.2").containsEntry("app_platform", "ios");
    }

    @Test
    void streamedOversizeBodyIsRejectedAfterReading() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/upload") {
            @Override
            public long getContentLengthLong() {
                return -1;
            }
        };
        request.setContent(new byte[RequestEnvelopeFilter.MAX_BODY + 1]);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, res) -> req.getInputStream().readAllBytes());

        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(accessJson()).containsEntry("status_code", 413).containsEntry("outcome", "completed")
                .containsEntry("http_route", "unmatched");
    }

    private ILoggingEvent accessEvent() {
        return appender.list.stream()
                .filter(candidate -> candidate.getMarkerList() != null
                        && candidate.getMarkerList().contains(ObservationJsonProvider.ACCESS))
                .reduce((first, second) -> second).orElseThrow();
    }

    /** 헤더별 «형식 어긋남» 카운터 값 — 한 번도 안 셌으면 미터가 없으므로 0. */
    private double invalid(String header) {
        var counter = metrics.find(RequestEnvelopeFilter.APP_HEADER_INVALID).tag("header", header).counter();
        return counter == null ? 0 : counter.count();
    }

    private static List<String> keysOf(ILoggingEvent event) {
        return event.getKeyValuePairs() == null ? List.of()
                : event.getKeyValuePairs().stream().map(kv -> kv.key).toList();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> accessJson() {
        return JSON.readValue(PROVIDER.format(accessEvent()), Map.class);
    }

    @RestController
    static class ProbeController {

        @GetMapping("/probe/{id}")
        String probe(@PathVariable("id") String id) {
            return "ok";
        }

        @GetMapping("/boom")
        String boom() {
            throw new IllegalStateException("boom");
        }
    }
}
