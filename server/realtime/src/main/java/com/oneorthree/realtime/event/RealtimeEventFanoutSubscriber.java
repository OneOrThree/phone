package com.oneorthree.realtime.event;

import com.oneorthree.realtime.common.redis.RedisKeys;
import com.oneorthree.realtime.fanout.FanoutTelemetry;
import com.oneorthree.realtime.logging.LogContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;

/**
 * 다른 인스턴스가 {@code chat:events:v1} 에 흘린 섬 사건을 받아 이 프로세스의 구독자에게 넘긴다.
 *
 * <p><b>자기가 보낸 것은 버린다.</b> Redis Pub/Sub 는 발행자 자신에게도 되돌려 주므로, 거르지 않으면
 * 발행한 인스턴스에 붙어 있는 사람만 같은 사건을 두 번 받는다 — 인스턴스가 한 대인 개발 환경에서는
 * «전원이 두 번»이라 눈에 띄지만, 두 대 이상이면 «일부만 두 번»이 되어 훨씬 찾기 어렵다.
 *
 * <p>역직렬화 실패는 해당 건만 버린다. 리스너에서 예외를 밖으로 던지면 컨테이너가 그 구독을 끊을 수
 * 있고, 그러면 <b>이 인스턴스만 조용히 실시간 수신이 죽는다</b>.
 *
 * <p>로그 연결(GROMO-2559): 받은 건마다 발행 쪽 원인({@code telemetry})과 {@code event_id}(섬 사건은 봉투의 eventId, 세션 폐기는
 * 메타데이터의 Data 사건 id)를 처리 동안 문맥에 두고 {@code fanout.receive} 한 줄을 남긴다. 메타데이터 없는 옛 발행자의 섬 사건도
 * 봉투 eventId 로 잇는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RealtimeEventFanoutSubscriber implements MessageListener {

    private final RealtimeEventDelivery delivery;
    private final InboundEventService inboundEventService;
    private final ObjectMapper objectMapper;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        RealtimeEventFanoutEvent event;
        try {
            event = objectMapper.readValue(
                    new String(message.getBody(), StandardCharsets.UTF_8), RealtimeEventFanoutEvent.class);
        } catch (RuntimeException e) {
            // 예외 «객체»를 통째로 기록하지 않는다 — Jackson 의 역직렬화 예외 메시지에는 깨진 JSON 조각이
            // 실리고, 거기엔 subject 같은 사용자 입력이 들어 있을 수 있다(LLD §6: 원문·payload 로깅 금지).
            log.error("섬 사건 팬아웃 수신 처리 실패 — 이 건만 버린다. reason={}", e.getClass().getName());
            received("invalid");
            return;
        }
        try (LogContext scope = FanoutTelemetry.install(event.telemetry())) {
            if (event.event() != null) {
                scope.put(LogContext.EVENT_ID, event.event().eventId().toString());
            }
            received(deliver(event));
        }
    }

    private String deliver(RealtimeEventFanoutEvent event) {
        try {
            if (delivery.instanceId().equals(event.originInstanceId())) {
                // 내가 발행한 것 — 로컬 전달은 deliver() 에서 이미 끝났다.
                return "self_echo";
            }
            if (event.revokedSessionId() != null && event.revokedUserId() != null) {
                // 세션 폐기 제어 사건 — 이 replica 의 펜스·캐시·세션만 정리한다. 멱등이고(펜스 merge, 세션이 없으면 no-op),
                // inbound_events 중복 차단은 HTTP/Kafka 입구(InboundEventService#accept)에만 있어 여기엔 걸리지 않는다.
                inboundEventService.applySessionRevocation(
                        event.revokedUserId(), event.revokedSessionId(), event.revokedUntil());
                return "delivered";
            }
            if (event.destination() == null || event.event() == null) {
                // 반쪽 제어 필드나 옛 발행자의 봉투 — 섬 사건으로도 제어 사건으로도 읽을 수 없다. 삼켜지는 IllegalArgumentException 대신 원인을 남긴다.
                log.warn("팬아웃 봉투가 섬 사건도 세션 폐기도 아니다 — 버린다");
                return "invalid";
            }
            delivery.deliverLocally(event.destination(), event.event(), event.recipients());
            return "delivered";
        } catch (RuntimeException e) {
            log.error("섬 사건 팬아웃 수신 처리 실패 — 이 건만 버린다. reason={}", e.getClass().getName());
            return "failed";
        }
    }

    private static void received(String result) {
        LogContext.info(log, LogContext.FANOUT_RECEIVE, "팬아웃 수신 — channel={} result={}",
                RedisKeys.EVENT_FANOUT_CHANNEL, result);
    }
}
