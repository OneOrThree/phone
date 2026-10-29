package com.oneorthree.phone.outbox.support;

import com.oneorthree.phone.common.logging.LogScope;
import datadog.trace.api.CorrelationIdentifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

/**
 * Outbox 봉투에 남기는 최초 원인 문맥 (GROMO-2557, 로그 계약 §2.2·§3).
 *
 * <p><b>origin 우선.</b> 지금 스레드에 {@code origin_request_id}·{@code origin_trace_id} 가 하나라도 있으면 그 쌍을
 * 그대로 쓴다 — 후속 사건이 원인을 자기 요청으로 바꾸지 않게. 둘 다 없을 때만 현재 {@code request_id} 와 활성 tracer 의
 * trace id 를 origin 으로 올린다. 쌍을 섞지 않는다(남의 origin 요청에 지금 trace 를 붙이면 둘이 다른 사건을 가리킨다).
 * 단 요청 필터({@code TraceIdFilter})가 받은 origin 을 형식·버전 검사로 버렸다는 {@code origin_dropped} 표식이 있으면 올리지 않고
 * 비운 채 저장한다 — 버린 문맥이 현재 호출의 문맥으로 바뀌지 않게.
 *
 * <p>trace id 는 {@link CorrelationIdentifier#getTraceId()} 원문이다 — dd-trace 1.64.0 은 128-bit 로그가 켜져 있고
 * 상위 64비트가 있으면 32자리 소문자 hex, 아니면 하위 64비트 10진을 돌려준다. 여기서 정규화하지 않는다.
 * agent 가 없거나 활성 span 이 없으면 {@code "0"} 이고 저장하지 않는다.
 *
 * @param requestId 원인 요청 ID — §2.1 형식만
 * @param traceId   원인 trace id 원문 — §2.1 형식이면서 64자 이하만(열 길이)
 */
public record OutboxOrigin(String requestId, String traceId) {

    /** {@code trace_context_version} 현재 값. */
    public static final short VERSION = 1;

    private static final Logger LOG = LoggerFactory.getLogger(OutboxOrigin.class);
    private static final int MAX_TRACE_LENGTH = 64;
    private static final OutboxOrigin NONE = new OutboxOrigin(null, null);

    /**
     * 지금 스레드의 문맥에서 캡처한다. 관측 실패가 명령 트랜잭션을 깨면 안 되므로 어떤 실패도 «문맥 없음»으로 접는다.
     *
     * @return 캡처한 원인 — 없으면 두 값 모두 {@code null}
     */
    public static OutboxOrigin capture() {
        try {
            String originRequest = MDC.get("origin_request_id");
            String originTrace = MDC.get("origin_trace_id");
            if (originRequest != null || originTrace != null) {
                return of(originRequest, originTrace);
            }
            if (MDC.get("origin_dropped") != null) {
                return NONE;
            }
            return of(MDC.get("request_id"), CorrelationIdentifier.getTraceId());
        } catch (RuntimeException | LinkageError e) {
            LOG.debug("outbox 원인 문맥 캡처 실패 — 문맥 없이 적는다 cause={}", e.getClass().getSimpleName());
            return NONE;
        }
    }

    /**
     * 후보 값을 검사해 담는다.
     *
     * @param requestId 요청 ID 후보
     * @param traceId   trace id 후보 — {@code "0"} 은 «없음»
     * @return 검사를 통과한 값만 든 원인
     */
    public static OutboxOrigin of(String requestId, String traceId) {
        String trace = "0".equals(traceId) ? null : LogScope.safeId(traceId);
        return new OutboxOrigin(LogScope.safeId(requestId),
                trace != null && trace.length() <= MAX_TRACE_LENGTH ? trace : null);
    }

    /** @return 값이 하나라도 있으면 {@link #VERSION}, 없으면 {@code null} */
    public Short version() {
        return requestId == null && traceId == null ? null : VERSION;
    }
}
