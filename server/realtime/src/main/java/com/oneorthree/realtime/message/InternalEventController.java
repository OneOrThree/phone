package com.oneorthree.realtime.message;

import com.oneorthree.realtime.event.InboundAcceptLog;
import com.oneorthree.realtime.event.InboundEventService;
import com.oneorthree.realtime.logging.LogContext;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.Map;

/**
 * Data 의 내구 사건 HTTP 수신구 {@code POST /internal/events} (GROMO-1943 · GROMO-1954).
 *
 * <p>본문은 Data outbox 의 <b>정본 봉투 그대로</b>다(알림 서버의 같은 경로와 같은 모양). 자격은
 * {@code InternalServiceTokenFilter} 의 Data 전용 토큰({@code SVC_TOKEN_DATA_TO_REALTIME})이 정하고,
 * 앱 AT·STOMP 로는 이 경로에 닿을 수 없다 — 앱 입력으로 tombstone 을 만들 수 없어야 한다.
 *
 * <p>처리는 Kafka 입구({@code realtime-events})와 같은 {@link InboundEventService} 하나다(2026-09-19 R-1).
 * 같은 {@code eventId} 의 재전달은 한 번만 적용되고 같은 200 을 돌려준다.
 *
 * <p>로그 연결(GROMO-2559): 토큰 관문을 통과한 요청의 원인 문맥 헤더(계약 §3)를 처리 동안 문맥에 둔다 — 관문 «앞»에서는 읽지 않는다.
 */
@RestController
@RequiredArgsConstructor
public class InternalEventController {

    private final InboundEventService inboundEventService;

    @PostMapping("/internal/events")
    public Map<String, Object> accept(@RequestBody JsonNode envelope, @RequestHeader HttpHeaders headers) {
        try (LogContext scope = LogContext.openInternalHttp(headers::getFirst)) {
            InboundAcceptLog.accept(inboundEventService, envelope, scope);
        }
        return Map.of("accepted", true);
    }
}
