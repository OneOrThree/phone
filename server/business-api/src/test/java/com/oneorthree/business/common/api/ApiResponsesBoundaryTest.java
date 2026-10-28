package com.oneorthree.business.common.api;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneorthree.business.linkpreview.exception.PreviewExceptionHandler;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;

/** 공개 HTTP 전송 상태와 서비스 내부 오류 분류를 분리한다. */
class ApiResponsesBoundaryTest {

    private final ApiResponses responses = new ApiResponses(new ObjectMapper());

    @ParameterizedTest
    @EnumSource(ApiErrorCode.class)
    void publicMvcAndFilterResponsesPreserveReasonsAndMapOnlyServerFailures(ApiErrorCode code) throws Exception {
        var request = new MockHttpServletRequest("GET", "/me");
        int internalStatus = code.getStatus().value();
        int expected = internalStatus >= 500 ? 400 : internalStatus;

        var mvc = responses.error(request, code, null, null);
        assertThat(mvc.getStatusCode().value()).isEqualTo(expected);
        var body = (ApiErrorResponse) mvc.getBody();
        assertThat(body.error().code()).isEqualTo(code.name());
        assertThat(body.error().retryable()).isEqualTo(code.isRetryable());

        var filter = new MockHttpServletResponse();
        responses.writeFilterError(request, filter, code, "내부 전용 문구");
        assertThat(filter.getStatus()).isEqualTo(expected);
        assertThat(filter.getContentAsString()).doesNotContain("내부 전용 문구");
        var filterBody = new ObjectMapper().readTree(filter.getContentAsString());
        assertThat(filterBody.path("error").path("code").stringValue()).isEqualTo(code.name());
        assertThat(filterBody.path("error").path("retryable").booleanValue()).isEqualTo(code.isRetryable());
    }

    @ParameterizedTest
    @EnumSource(value = ApiErrorCode.class, names = {
            "INTERNAL_ERROR", "UPSTREAM_CONTRACT_ERROR", "UPSTREAM_AUTH_FAILED", "SERVICE_UNAVAILABLE", "UPSTREAM_TIMEOUT"
    })
    void internalResponsesRetainServerFailureStatuses(ApiErrorCode code) throws Exception {
        var request = new MockHttpServletRequest("GET", "/internal/health");
        var response = new MockHttpServletResponse();
        responses.writeFilterError(request, response, code, "내부 전용 문구");
        assertThat(response.getStatus()).isEqualTo(code.getStatus().value()).isGreaterThanOrEqualTo(500);
        assertThat(responses.error(request, code, null, null).getStatusCode()).isEqualTo(code.getStatus());
    }

    @ParameterizedTest
    @CsvSource({"/link-previews/item,400", "/api/v1/link-previews/item,503"})
    void previewFailurePreservesRetryAfterAndHidesStorageDetails(String path, int status) {
        var request = new MockHttpServletRequest("GET", path);
        var handler = new PreviewExceptionHandler(responses);
        var result = handler.unavailable(new DataAccessResourceFailureException("private Redis address"), request);

        assertThat(result.getStatusCode().value()).isEqualTo(status);
        assertThat(result.getHeaders().getFirst("Retry-After")).isEqualTo("10");
        String body = new ObjectMapper().writeValueAsString(result.getBody());
        assertThat(body).contains("SERVICE_UNAVAILABLE").doesNotContain("private Redis address");
        if (path.startsWith("/link-previews/")) {
            assertThat(((ApiErrorResponse) result.getBody()).error().retryable()).isTrue();
        }
    }

    @ParameterizedTest
    @CsvSource({"INTERNAL_ERROR,500", "UPSTREAM_CONTRACT_ERROR,502", "UPSTREAM_AUTH_FAILED,502",
            "SERVICE_UNAVAILABLE,503", "UPSTREAM_TIMEOUT,504"})
    void recordsInternalStatusWithTheResponseRequestIdWithoutRequestSecrets(ApiErrorCode code, int internalStatus)
            throws Exception {
        var request = new MockHttpServletRequest("GET", "/me");
        request.addHeader("Authorization", "Bearer private-token");
        request.addHeader("X-Request-Id", "untrusted-request-id");
        request.setQueryString("private-db-value");
        Logger logger = (Logger) LoggerFactory.getLogger(ApiResponses.class);
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            var result = responses.error(request, code, null, null);
            String requestId = ((ApiErrorResponse) result.getBody()).requestId();
            var filter = new MockHttpServletResponse();
            responses.writeFilterError(request, filter, code, "private-sql-detail");

            assertThat(code.getStatus().value()).isEqualTo(internalStatus);
            assertThat(requestId).isNotEqualTo("untrusted-request-id");
            assertThat(new ObjectMapper().readTree(filter.getContentAsString()).path("requestId").stringValue())
                    .isEqualTo(requestId);
            String expected = "business_public_failure request_id=" + requestId + " internal_status="
                    + internalStatus + " public_status=400 code=" + code.name();
            assertThat(appender.list).hasSize(2).allSatisfy(event -> {
                assertThat(event.getLevel()).isEqualTo(Level.ERROR);
                assertThat(event.getFormattedMessage()).isEqualTo(expected);
                assertThat(event.getThrowableProxy()).isNull();
            });
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }
}
