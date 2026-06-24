package com.oneorthree.phone.common.config;

import java.io.IOException;
import java.util.UUID;

import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

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

            Object userId = request.getAttribute("userId");
            if (userId != null) {
                MDC.put(MDC_USER_ID, userId.toString());
            }

            filterChain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
