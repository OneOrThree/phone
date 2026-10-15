package com.oneorthree.realtime.event;

import org.apache.kafka.common.TopicPartition;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;
import tools.jackson.databind.ObjectMapper;

/**
 * {@code realtime-events} 소비자 — HTTP 입구와 <b>같은</b> {@link InboundEventService} 로 넘긴다 (2026-09-19 R-1).
 * 알림 서버 {@code KafkaInbound} 와 같은 모양이고, 기본은 꺼짐이다({@code REALTIME_EVENTS_KAFKA_ENABLED}).
 *
 * <p>처리기가 반환할 때 DB 커밋이 끝난다(ack-mode record). 실패는 3회 재시도 뒤 원 파티션의 {@code .DLT} 로
 * 보내고, DLT 발행 실패를 성공으로 삼키지 않는다.
 *
 * <p>⚠️ 다중 인스턴스: 소비 그룹이 하나라 사건 하나를 <b>한 인스턴스만</b> 받는다. {@code user.withdrawn} 처럼
 * DB 만 바꾸는 사건은 그걸로 충분하지만, 앱 전달(STOMP)을 켜면 모든 인스턴스가 모든 사건을 받아야 한다 —
 * 그때 인스턴스별 소비 그룹(HTTP 입구는 Redis 재분배)으로 바꾼다. 지금은 단일 인스턴스다.
 */
@Configuration
@ConditionalOnProperty(name = "realtime.events.kafka-enabled", havingValue = "true")
class KafkaEventInbound {

    private final InboundEventService inbound;
    private final ObjectMapper objectMapper;

    KafkaEventInbound(InboundEventService inbound, ObjectMapper objectMapper) {
        this.inbound = inbound;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(topics = "${realtime.events.kafka-topic}", groupId = "realtime-v1")
    public void receive(String value) {
        inbound.accept(objectMapper.readTree(value));
    }

    @Bean
    DefaultErrorHandler realtimeEventsErrorHandler(KafkaTemplate<Object, Object> template) {
        // Spring Kafka 4 의 기본 접미사는 -dlt 다. Data 가 만드는 .DLT 계약(OutboxRelayConfig)에 맞춘다.
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(template,
                (record, failure) -> new TopicPartition(record.topic() + ".DLT", record.partition()));
        recoverer.setFailIfSendResultIsError(true);
        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, new FixedBackOff(1000L, 3L));
        handler.setResetStateOnRecoveryFailure(true);
        return handler;
    }
}
