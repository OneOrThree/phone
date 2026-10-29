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
 * <p>서비스 간 연결 키는 {@code request_id} 다. business-api·realtime 이 내부 호출마다 실어 보내는
 * {@code X-Request-Id} 가 그대로 {@code request_id} 가 된다. 레거시 {@code trace_id} 는
 * {@code X-Trace-Id} 를 먼저 보고, 비어 있으면 호환을 위해 {@code X-Request-Id} 를 이어받는다. 둘 다 없거나
 * 아래 검사에 걸리면 하이픈 없는 UUID 를 새로 만든다. userId 는 인증된 요청에서만 붙으므로 화이트리스트
 * 경로의 로그에는 {@code user_id} 가 없다.
 *
 * <p>헤더 값은 호출자가 정하는 외부 입력이라 로그 패턴에 그대로 실린다. 줄바꿈·구분자 같은 문자로
 * 로그 줄을 위조하거나 과도하게 긴 값으로 로그를 부풀리지 못하도록, 앞뒤 공백을 걷어 낸 뒤
 * {@code [A-Za-z0-9_-]{1,128}} 에 맞는 값만 받는다(UUID 36자·하이픈 없는 32자 모두 통과).
 *
 * <p>MDC 는 스레드 로컬이고 톰캣 스레드는 재사용되므로, 다음 요청이 남은 값을 물려받지 않도록
 * {@code finally} 에서 이 필터가 소유한 키만 복원한다. tracer·다른 필터의 MDC는 건드리지 않는다.
 * request_id는 X-Request-Id를 별도로 검증해 기록한다. 기존 trace_id는 레거시 상관 ID이며 APM span ID가 아니다.
 */
@Slf4j
public class TraceIdFilter extends OncePerRequestFilter {

    private static final String TRACE_ID_HEADER = "X-Trace-Id";
    private static final String REQUEST_ID_HEADER = "X-Request-Id";
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_-]{1,128}");
    private static final String MDC_TRACE_ID = "trace_id";
    private static final String MDC_USER_ID = "user_id";
    private static final String MDC_REQUEST_ID = "request_id";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String previousTraceId = MDC.get(MDC_TRACE_ID);
        String previousRequestId = MDC.get(MDC_REQUEST_ID);
        String previousUserId = MDC.get(MDC_USER_ID);
        try {
            String traceId = resolveTraceId(request);
            MDC.put(MDC_TRACE_ID, traceId);
            String candidate = trim(request.getHeader(REQUEST_ID_HEADER));
            String requestId = candidate.isEmpty() ? traceId : candidate;
            if (!candidate.isEmpty() && !SAFE_ID.matcher(candidate).matches()) {
                // trace_id 쪽과 같은 정책 — 외부 입력 원문은 싣지 않고 헤더명·길이만 남긴다.
                log.debug("상관 ID 헤더를 버리고 새로 만든다 header={} length={}", REQUEST_ID_HEADER, candidate.length());
                // request_id 폴백은 Business 가 만드는 ID 와 같은 하이픈 포함 UUID, trace_id 폴백(아래)은 하이픈 없는 32자.
                requestId = UUID.randomUUID().toString();
            }
            MDC.put(MDC_REQUEST_ID, requestId);
            MDC.remove(MDC_USER_ID);

            Object userId = request.getAttribute(AuthAttributes.USER_ID);
            if (userId != null) {
                MDC.put(MDC_USER_ID, userId.toString());
            }

            filterChain.doFilter(request, response);
        } finally {
            restore(MDC_TRACE_ID, previousTraceId);
            restore(MDC_REQUEST_ID, previousRequestId);
            restore(MDC_USER_ID, previousUserId);
        }
    }

    /**
     * X-Trace-Id → X-Request-Id 순으로 비어 있지 않은 첫 값을 검사해 쓰고, 없거나 검사에 걸리면 새로 만든다.
     * 헤더 값이 있는데 검사에 걸려 버릴 때만 debug 로그를 남기며, 값은 외부 입력이라 싣지 않고
     * 어느 헤더였는지와 길이만 남긴다.
     *
     * <p>이 로그는 debug 라 평소(dev·prod root INFO) 꺼져 있고, 추적이 필요할 때 이 로거의 레벨만
     * 올린다. INFO 로 두면 외부 호출자가 마음대로 일으킬 수 있는 경로라 로그 증폭 수단이 된다.
     * 이 로그는 MDC 에 새 trace_id 를 싣기 전에 찍히므로 그 줄의 trace_id 칸은 비어 있다 —
     * 헤더 이름·길이로 찾는다.
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

    private static void restore(String key, String value) {
        if (value == null) {
            MDC.remove(key);
        } else {
            MDC.put(key, value);
        }
    }

    private static String trim(String header) {
        return header == null ? "" : header.strip();
    }
}
