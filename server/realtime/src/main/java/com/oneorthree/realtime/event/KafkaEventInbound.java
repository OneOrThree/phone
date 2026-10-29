package com.oneorthree.realtime.event;

import com.oneorthree.realtime.logging.LogContext;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.Header;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;

/**
 * {@code realtime-events} 소비자 — HTTP 입구와 <b>같은</b> {@link InboundEventService} 로 넘긴다 (2026-09-19 R-1).
 * 알림 서버 {@code KafkaInbound} 와 같은 모양이고, 기본은 꺼짐이다({@code REALTIME_EVENTS_KAFKA_ENABLED}).
 *
 * <p>처리기가 반환할 때 DB 커밋이 끝난다(ack-mode record). 실패는 3회 재시도 뒤 원 파티션의 {@code .DLT} 로
 * 보내고, DLT 발행 실패를 성공으로 삼키지 않는다.
 *
 * <p>다중 인스턴스: 소비 그룹이 하나라 사건 하나를 <b>한 인스턴스만</b> 받고, 다른 인스턴스의 STOMP 세션에는
 * {@code RealtimeEventDelivery} 가 Redis Pub/Sub({@code chat:events:v1})으로 다시 뿌린다 — 인스턴스별 소비 그룹이
 * 아니다(HTTP 입구도 같은 길을 타야 하므로). 커밋 시점·리밸런싱·소비 그룹·파티션 상한의 근거는
 * {@code docs/architecture/kafka-consumption.md}.
 *
 * <p>로그 연결(GROMO-2559): 레코드 헤더의 원인 문맥(계약 §3 — origin·event·delivery·attempt)을 처리 동안 문맥에 두고 끝나면
 * 되돌린다. 헤더는 관측 전용이라 형식이 틀리면 그 키만 버리고, 본문·중복 판정·DLT 는 그대로다(DLT 발행기는 원본 헤더를 복사한다).
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
    public void receive(ConsumerRecord<String, String> record) {
        try (LogContext scope = LogContext.openCarrier(name -> header(record, name))) {
            InboundAcceptLog.accept(inbound, objectMapper.readTree(record.value()), scope);
        }
    }

    private static String header(ConsumerRecord<String, String> record, String name) {
        Header header = record.headers().lastHeader(name);
        return header == null || header.value() == null ? null : new String(header.value(), StandardCharsets.UTF_8);
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
