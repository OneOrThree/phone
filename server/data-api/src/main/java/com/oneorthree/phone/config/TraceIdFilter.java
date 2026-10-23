package com.oneorthree.phone.config;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

import com.oneorthree.phone.common.auth.AuthAttributes;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 요청 단위 로그 상관관계 키를 MDC 에 싣는 필터 — {@link FilterConfig} 가 {@code /internal/*} 에
 * order 2 로 등록한다. {@link InternalAuthFilter}(1) 뒤라야 인증이 심어 둔 userId 를 볼 수 있다.
 *
 * <p>상관 ID 는 {@code X-Trace-Id} 헤더를 먼저 보고, 비어 있으면 {@code X-Request-Id} 를 이어받는다.
 * business-api·realtime 이 내부 호출마다 {@code X-Request-Id} 를 실어 보내므로, 이를 trace_id 로
 * 이어받아야 한 요청이 호출한 쪽과 이쪽 로그에서 같은 값으로 꿰인다. 둘 다 없거나 아래 검사에
 * 걸리면 하이픈 없는 UUID 를 새로 만든다. userId 는 인증된 요청에서만 붙으므로 화이트리스트
 * 경로의 로그에는 {@code user_id} 가 없다.
 *
 * <p>헤더 값은 호출자가 정하는 외부 입력이라 로그 패턴에 그대로 실린다. 줄바꿈·구분자 같은 문자로
 * 로그 줄을 위조하거나 과도하게 긴 값으로 로그를 부풀리지 못하도록, 앞뒤 공백을 걷어 낸 뒤
 * {@code [A-Za-z0-9_-]{1,128}} 에 맞는 값만 받는다(UUID 36자·하이픈 없는 32자 모두 통과).
 *
 * <p>MDC 는 스레드 로컬이고 톰캣 스레드는 재사용되므로, 다음 요청이 남은 값을 물려받지 않도록
 * {@code finally} 에서 반드시 비운다.
 */
@Slf4j
public class TraceIdFilter extends OncePerRequestFilter {

    private static final String TRACE_ID_HEADER = "X-Trace-Id";
    private static final String REQUEST_ID_HEADER = "X-Request-Id";
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_-]{1,128}");
    private static final String MDC_TRACE_ID = "trace_id";
    private static final String MDC_USER_ID = "user_id";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            MDC.put(MDC_TRACE_ID, resolveTraceId(request));

            Object userId = request.getAttribute(AuthAttributes.USER_ID);
            if (userId != null) {
                MDC.put(MDC_USER_ID, userId.toString());
            }

            filterChain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }

    /**
     * X-Trace-Id → X-Request-Id 순으로 비어 있지 않은 첫 값을 검사해 쓰고, 없거나 검사에 걸리면 새로 만든다.
     * 헤더 값이 있는데 검사에 걸려 버릴 때만 debug 로그를 남기며, 값은 외부 입력이라 싣지 않고
     * 어느 헤더였는지와 길이만 남긴다.
     */
    private static String resolveTraceId(HttpServletRequest request) {
        String header = TRACE_ID_HEADER;
        String candidate = trim(request.getHeader(TRACE_ID_HEADER));
        if (candidate.isEmpty()) {
            header = REQUEST_ID_HEADER;
            candidate = trim(request.getHeader(REQUEST_ID_HEADER));
        }
        if (SAFE_ID.matcher(candidate).matches()) {
            return candidate;
        }
        if (!candidate.isEmpty()) {
            log.debug("상관 ID 헤더를 버리고 새로 만든다 header={} length={}", header, candidate.length());
        }
        return UUID.randomUUID().toString().replace("-", "");
    }

    private static String trim(String header) {
        return header == null ? "" : header.strip();
    }
}
