package com.oneorthree.phone.common.config;

import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 역직렬화 전 본문 크기 가드 (GROMO-1252 코드리뷰 5차 ④).
 *
 * <p>{@code @Size(max=32)} 는 Jackson 이 맵을 전부 만든 뒤에야 돌기 때문에, 모더레이션 경로에만 있던
 * 이 필터를 집중 세션 저장(POST)·종료(PATCH) 경로에도 등록했다.
 */
class RequestSizeLimitFilterTest {

    private static final String FOCUS_PATH = "/api/v1/focus-session";

    private MockHttpServletResponse callFocusFilter(int contentLength) throws Exception {
        FilterRegistrationBean<RequestSizeLimitFilter> bean =
                new FilterConfig(null, null, null).focusSessionRequestSizeFilter();
        assertThat(bean.getUrlPatterns()).containsExactly(FOCUS_PATH);

        MockHttpServletRequest request = new MockHttpServletRequest("POST", FOCUS_PATH);
        request.setContent(new byte[contentLength]);
        MockHttpServletResponse response = new MockHttpServletResponse();
        bean.getFilter().doFilter(request, response, new MockFilterChain());
        return response;
    }

    @Test
    @DisplayName("집중 세션 경로 — 상한 초과 본문은 역직렬화 전에 413 으로 끊긴다")
    void oversizedFocusBodyIsRejectedBeforeDeserialization() throws Exception {
        MockHttpServletResponse response = callFocusFilter(8 * 1024 + 1);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
        assertThat(response.getContentAsString()).contains("PAYLOAD_TOO_LARGE");
    }

    @Test
    @DisplayName("상한 이내 본문은 그대로 통과한다")
    void bodyWithinLimitPasses() throws Exception {
        assertThat(callFocusFilter(8 * 1024).getStatus()).isEqualTo(HttpServletResponse.SC_OK);
    }

    /** 상한 근거 검증 — 엔트리 수 상한(32)을 꽉 채운 최악 본문도 8KiB 에 한참 못 미친다. */
    @Test
    @DisplayName("32엔트리 분포 + 나머지 필드를 꽉 채운 정상 본문은 상한에 걸리지 않는다")
    void maxLegitimateBodyIsWellUnderLimit() {
        StringBuilder body = new StringBuilder()
                .append("{\"focusTagId\":\"").append(UUID.randomUUID())
                .append("\",\"startedAt\":\"2026-08-08T14:50:00.800Z\"")
                .append(",\"endedAt\":\"2026-09-08T15:10:00.800Z\"")
                .append(",\"totalDistractionSeconds\":2147483647")
                .append(",\"focusType\":\"POMODORO\",\"focusSecondsByDate\":{");
        for (int i = 0; i < FocusSessionRequest.MAX_SECONDS_BY_DATE_ENTRIES; i++) {
            body.append(i > 0 ? "," : "").append("\"2026-08-").append(String.format("%02d", i + 1))
                    .append("\":2147483647");
        }
        body.append("}}");

        assertThat(body.toString().getBytes(StandardCharsets.UTF_8).length).isLessThan(8 * 1024 / 4);
    }
}
