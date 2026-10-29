package com.oneorthree.business.config;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.business.common.api.ApiResponses;
import com.oneorthree.business.common.logging.ObservationJsonProvider;
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

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 RequestEnvelopeFilter + 실제 MVC 경로 매칭으로 접근 로그 JSON 필드를 본다. */
class RequestEnvelopeAccessLogTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObservationJsonProvider PROVIDER = new ObservationJsonProvider(new MockEnvironment());

    private final RequestEnvelopeFilter filter = new RequestEnvelopeFilter(new ApiResponses(new JsonMapper()));
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
    void unhandledExceptionOmitsUndecidedStatus() {
        assertThatThrownBy(() -> mockMvc.perform(get("/boom"))).hasRootCauseMessage("boom");

        Map<String, Object> json = accessJson();
        assertThat(json).containsEntry("log_kind", "access").containsEntry("http_route", "/boom")
                .containsEntry("outcome", "unhandled_exception").doesNotContainKey("status_code");
        assertThat((String) json.get("message")).contains("status=unhandled_exception");
    }

    @Test
    void declaredOversizeBodyIsRejectedBeforeRouting() throws Exception {
        mockMvc.perform(post("/probe/1").content(new byte[RequestEnvelopeFilter.MAX_BODY + 1]))
                .andExpect(status().isPayloadTooLarge());

        assertThat(accessJson()).containsEntry("http_method", "POST").containsEntry("http_route", "unmatched")
                .containsEntry("status_code", 413).containsEntry("outcome", "completed");
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

    @SuppressWarnings("unchecked")
    private Map<String, Object> accessJson() {
        ILoggingEvent event = appender.list.stream()
                .filter(candidate -> candidate.getMarkerList() != null
                        && candidate.getMarkerList().contains(ObservationJsonProvider.ACCESS))
                .reduce((first, second) -> second).orElseThrow();
        return JSON.readValue(PROVIDER.format(event), Map.class);
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
