package com.oneorthree.realtime.event;

import com.oneorthree.realtime.logging.LogContext;
import lombok.extern.slf4j.Slf4j;
import org.aopalliance.intercept.MethodInterceptor;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.Header;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaOperations;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.ConsumerAwareRecordRecoverer;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.listener.RetryListener;
import org.springframework.util.backoff.FixedBackOff;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

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
 *
 * <p>재시도·DLT 로그(GROMO-2581): 리스너가 던진 뒤의 일은 리스너 scope 밖(오류 처리기)이라, 실패한 레코드의 같은 헤더로 다시 연다 —
 * {@link RetryLog} 의 시도·DLT 줄과 DLT 발행기 자신의 로그(발행 실패 등)가 같은 {@code event_id}·원인을 단다. 재시도 횟수·DLT 판정·
 * 발행 실패를 성공으로 삼키지 않는 동작은 그대로다(발행기를 감싸기만 한다). 발행이 비동기로 끝나면 발행기의 완료 콜백은 producer
 * 스레드에서 돌므로, 발행 결과 future 를 그 레코드 문맥 안에서 완료시킨다({@link #completingInContext}).
 */
@Slf4j
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

    private static String header(ConsumerRecord<?, ?> record, String name) {
        Header header = record.headers().lastHeader(name);
        return header == null || header.value() == null ? null : new String(header.value(), StandardCharsets.UTF_8);
    }

    @Bean
    DefaultErrorHandler realtimeEventsErrorHandler(KafkaTemplate<Object, Object> template) {
        // Spring Kafka 4 의 기본 접미사는 -dlt 다. Data 가 만드는 .DLT 계약(OutboxRelayConfig)에 맞춘다.
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(completingInContext(template),
                (record, failure) -> new TopicPartition(record.topic() + ".DLT", record.partition()));
        recoverer.setFailIfSendResultIsError(true);
        ConsumerAwareRecordRecoverer withContext = (record, consumer, failure) -> {
            try (LogContext scope = carrier(record)) {
                recoverer.accept(record, consumer, failure);
            }
        };
        DefaultErrorHandler handler = new DefaultErrorHandler(withContext, new FixedBackOff(1000L, 3L));
        handler.setResetStateOnRecoveryFailure(true);
        handler.setRetryListeners(new RetryLog());
        return handler;
    }

    private static LogContext carrier(ConsumerRecord<?, ?> record) {
        return LogContext.openCarrier(name -> header(record, name));
    }

    /**
     * 발행 결과 future 를 «보낸 스레드의 문맥을 깐 채» 완료되는 새 future 로 바꿔 돌려준다(GROMO-2581 r1). 발행기는 {@code send} 가 준
     * future 에 완료 콜백({@code Dead-letter publication ... failed})을 거는데, 그 콜백은 future 를 완료한 스레드 — 비동기 실패면
     * producer 스레드 — 에서 돈다. 새 future 는 원래 future 가 끝날 때 그 문맥 안에서 완료되므로 콜백도 그 안에서 돌고, 끝나면 그 스레드
     * 값으로 되돌린다. 이미 끝난 future 면 소비자 스레드의 레코드 scope 안에서 바로 돈다. 값·예외는 그대로 넘긴다(DLT 판정·
     * {@code failIfSendResultIsError} 대기 같음). 발행기를 하위 클래스로 만들지 않는 이유: 로거 이름이 {@code getClass()} 라 바뀐다.
     * spring-kafka 4.0.5 의 {@code verifySendResult} 는 {@code get(timeout)} 만 하고 future 에 {@code cancel} 을 부르지 않으므로
     * (타임아웃도 예외로만 넘긴다) 취소 전파는 두지 않는다. 트랜잭션 템플릿의 {@code executeInTransaction} 콜백으로 넘어가는 원본
     * 템플릿은 프록시를 거치지 않는다 — 지금 realtime 은 트랜잭션 설정이 없어 해당 없음, 켜면 이 경로 문맥이 빠진다.
     */
    private static KafkaOperations<?, ?> completingInContext(KafkaOperations<?, ?> template) {
        ProxyFactory proxy = new ProxyFactory(template);
        proxy.addAdvice((MethodInterceptor) call -> {
            Object result = call.proceed();
            if (!(result instanceof CompletableFuture<?> sent)) {
                return result;
            }
            Map<String, String> context = LogContext.capture();
            CompletableFuture<Object> relayed = new CompletableFuture<>();
            sent.whenComplete((value, failure) -> {
                try (LogContext scope = LogContext.replace(context)) {
                    if (failure == null) {
                        relayed.complete(value);
                    } else {
                        relayed.completeExceptionally(failure);
                    }
                }
            });
            return relayed;
        });
        return (KafkaOperations<?, ?>) proxy.getProxy();
    }

    /**
     * 오류 처리기의 시도·복구 결과 한 줄씩 — 실패한 레코드의 헤더 문맥 안에서 남긴다. 예외 «객체»는 남기지 않는다(역직렬화 메시지에
     * 본문 조각이 실릴 수 있다). {@code deliveryAttempt} 는 이 소비자의 시도 번호이고, MDC {@code attempt} 는 헤더로 받은 relay 의
     * 시도 번호다(계약 §2.1).
     */
    static final class RetryLog implements RetryListener {

        @Override
        public void failedDelivery(ConsumerRecord<?, ?> record, Exception ex, int deliveryAttempt) {
            try (LogContext scope = carrier(record)) {
                log.warn("Kafka 사건 처리 실패 — deliveryAttempt={} topic={} partition={} offset={} reason={}",
                        deliveryAttempt, record.topic(), record.partition(), record.offset(), reason(ex));
            }
        }

        @Override
        public void recovered(ConsumerRecord<?, ?> record, Exception ex) {
            try (LogContext scope = carrier(record)) {
                log.error("Kafka 사건 재시도 소진 — DLT 로 보냈다. topic={} partition={} offset={} reason={}",
                        record.topic(), record.partition(), record.offset(), reason(ex));
            }
        }

        @Override
        public void recoveryFailed(ConsumerRecord<?, ?> record, Exception original, Exception failure) {
            try (LogContext scope = carrier(record)) {
                log.error("Kafka 사건 DLT 발행 실패 — 재시도를 처음부터 다시 한다. topic={} partition={} offset={} reason={}",
                        record.topic(), record.partition(), record.offset(), reason(failure));
            }
        }

        private static String reason(Exception ex) {
            return ex == null ? null : NestedExceptionUtils.getMostSpecificCause(ex).getClass().getName();
        }
    }
}
