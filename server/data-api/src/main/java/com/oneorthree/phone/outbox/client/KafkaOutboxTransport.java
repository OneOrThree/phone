package com.oneorthree.phone.outbox.client;

import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * {@code notification-events} 발행 (A12 · A21).
 *
 * <p><b>키는 {@code userId} 다.</b> 같은 유저의 이벤트가 한 파티션에 모여 브로커 도착 순서가 보존된다 —
 * 다만 그것만으로는 역순 적용을 못 막으므로 소비자는 봉투의 {@code version} 을 함께 본다.
 *
 * <p><b>동기 확인 후에만 성공으로 돌려준다.</b> 비동기 콜백에서 표시하면 프로세스가 죽는 순간
 * 「발행했다고 믿는데 브로커엔 없는」 구간이 생긴다. 확인에 성공하고 표시에 실패하면 다음 틱이 다시
 * 보내 중복이 나지만, 수신 측이 {@code eventId} 로 멱등이라 안전하다 — at-least-once 는 이 방향으로만
 * 틀려야 한다.
 */
@Slf4j
@RequiredArgsConstructor
public class KafkaOutboxTransport implements OutboxTransport {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final OutboxRelayProperties properties;

    @Override
    public OutboxTarget target() {
        return OutboxTarget.KAFKA;
    }

    @Override
    public OutboxTransportResult send(EventOutboxDelivery delivery, UUID userId) {
        String topic = properties.getKafka().getTopic();
        String value = OutboxEnvelopeCodec.toJson(delivery.getPayload());
        try {
            kafkaTemplate.send(topic, userId.toString(), value)
                    .get(properties.getKafka().getSendTimeout().toMillis(), TimeUnit.MILLISECONDS);
            return OutboxTransportResult.success();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return OutboxTransportResult.retry("발행 대기 중 인터럽트");
        } catch (ExecutionException | TimeoutException e) {
            // 브로커 단일 노드라 재시작·디스크 압박이 그대로 여기로 온다. HTTP 로 우회하지 않는다 —
            // A18 이 그 정책을 아직 정하지 않았다.
            log.warn("Kafka 발행 실패 — deliveryId={} topic={}", delivery.getId(), topic, e);
            return OutboxTransportResult.retry(summarize(e));
        } catch (RuntimeException e) {
            // send() 는 «퓨처를 주기 전에» 던질 수 있다 — 메타데이터 조회 실패·버퍼 고갈이면
            // KafkaException 이 그 자리에서 난다(브로커 중단 테스트에서 실제로 재현됐다).
            // 이걸 흘려보내면 예외가 relay 틱을 통째로 끊어, 같은 틱에 선점한 «다른» 행들이
            // 표시도 못 받고 리스만 문 채 남는다. 유실이 아니라 지연이지만 이유 없는 지연이다.
            log.warn("Kafka 발행이 동기 예외로 실패 — deliveryId={} topic={}", delivery.getId(), topic, e);
            return OutboxTransportResult.retry(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private static String summarize(Exception e) {
        Throwable cause = e.getCause() == null ? e : e.getCause();
        return cause.getClass().getSimpleName() + ": " + cause.getMessage();
    }
}
