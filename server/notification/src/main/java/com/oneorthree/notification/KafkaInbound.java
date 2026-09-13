package com.oneorthree.notification;

import org.apache.kafka.common.TopicPartition;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/** 수신 서비스가 반환할 때 DB 커밋이 끝난다. 예외/DLT 발행 실패를 성공으로 삼키지 않는다. */
@Configuration
@ConditionalOnProperty(name = "notification.kafka-enabled", havingValue = "true")
class KafkaInbound {

    private final InboundService inbound;

    KafkaInbound(InboundService inbound) {
        this.inbound = inbound;
    }

    @KafkaListener(topics = "notification-events", groupId = "notification-v1")
    public void receive(String value) {
        inbound.accept(Json.map(value));
    }

    @Bean
    DefaultErrorHandler notificationErrorHandler(KafkaTemplate<Object, Object> template) {
        // Spring Kafka 4의 기본 접미사는 -dlt다. 조직의 기존 .DLT 계약을 명시적으로 유지한다.
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(template,
                (record, failure) -> new TopicPartition(record.topic() + ".DLT", record.partition()));
        recoverer.setFailIfSendResultIsError(true);
        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, new FixedBackOff(1000L, 3L));
        handler.setResetStateOnRecoveryFailure(true);
        return handler;
    }
}
