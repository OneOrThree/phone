package com.oneorthree.phone.config;

import java.io.IOException;
import java.util.UUID;

import com.oneorthree.phone.common.auth.AuthAttributes;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 요청 단위 로그 상관관계 키를 MDC 에 싣는 필터 — {@link FilterConfig} 가 {@code /api/*} 에
 * order 2 로 등록한다. {@link JwtFilter}(1) 뒤라야 인증이 심어 둔 userId 를 볼 수 있다.
 *
 * <p>{@code X-Trace-Id} 헤더가 오면 그 값을 그대로 이어받아 앱→서버 로그가 한 줄로 꿰이고,
 * 없거나 공백이면 하이픈 없는 UUID 를 새로 만든다. userId 는 인증된 요청에서만 붙으므로
 * 화이트리스트 경로의 로그에는 {@code user_id} 가 없다.
 *
 * <p>MDC 는 스레드 로컬이고 톰캣 스레드는 재사용되므로, 다음 요청이 남은 값을 물려받지 않도록
 * {@code finally} 에서 반드시 비운다.
 */
public class TraceIdFilter extends OncePerRequestFilter {

    private static final String TRACE_ID_HEADER = "X-Trace-Id";
    private static final String MDC_TRACE_ID = "trace_id";
    private static final String MDC_USER_ID = "user_id";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            String traceId = request.getHeader(TRACE_ID_HEADER);
            if (traceId == null || traceId.isBlank()) {
                traceId = UUID.randomUUID().toString().replace("-", "");
            }
            MDC.put(MDC_TRACE_ID, traceId);

            Object userId = request.getAttribute(AuthAttributes.USER_ID);
            if (userId != null) {
                MDC.put(MDC_USER_ID, userId.toString());
            }

            filterChain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
