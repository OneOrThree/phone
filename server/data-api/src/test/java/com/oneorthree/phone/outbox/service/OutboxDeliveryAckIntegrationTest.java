package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 빠른 완료표시({@link OutboxDeliveryAckPort})의 <b>오표시 금지</b> 검증 (㊿ · ㊲).
 *
 * <p>이 경로는 「직접 전달에 성공했다」는 호출자의 주장을 받아 전달 하나를 닫는다. 그래서 검증의
 * 중심은 「닫히는가」가 아니라 <b>「닫히면 안 되는 것이 닫히지 않는가」</b>다 — 남의 것 · 다른 대상 ·
 * 먼저 실패해 남아 있는 대상 · 낡은 relay 표시.
 *
 * <p>실물 PostgreSQL + 실제 Flyway V51 위에서 돈다. relay 는 꺼져 있다 — 빠른 경로는 relay 가 없는
 * 기동에서도 동작해야 한다(오히려 그때가 유일한 전달 경로다).
 */
@SpringBootTest
class OutboxDeliveryAckIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    OutboxCommandPort outboxCommandPort;
    @Autowired
    OutboxDeliveryAckPort ackPort;
    @Autowired
    EventOutboxRepository outboxRepository;
    @Autowired
    EventOutboxDeliveryRepository deliveryRepository;
    @Autowired
    PlatformTransactionManager transactionManager;

    @BeforeEach
    void isolateRelayQueue() {
        // 전체 suite의 앞선 도메인 테스트가 만든 전달 행이 제한된 claimBatch를 차지하지 않게 한다.
        deliveryRepository.deleteAll();
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    @Test
    @DisplayName("직접 전달에 성공한 소유자가 알림 대상을 닫는다 — 재호출은 이미 닫힘으로 멱등하다")
    void ownerClosesNotificationDeliveryAndRepeatIsIdempotent() {
        UUID userId = UUID.randomUUID();
        UUID outboxId = appendDeviceTokenDelete(userId);

        assertThat(ackPort.acknowledgeNotificationDelivery(userId, outboxId))
                .isEqualTo(OutboxDeliveryAckPort.AckOutcome.MARKED);
        Instant closedAt = delivery(outboxId, OutboxTarget.NOTI).getDeliveredAt();
        assertThat(closedAt).isNotNull();

        assertThat(ackPort.acknowledgeNotificationDelivery(userId, outboxId))
                .as("재시도가 400/404 로 떨어지면 호출자가 「실패했다」고 믿고 다시 보낸다")
                .isEqualTo(OutboxDeliveryAckPort.AckOutcome.ALREADY_MARKED);
        assertThat(delivery(outboxId, OutboxTarget.NOTI).getDeliveredAt())
                .as("표시 시각이 뒤로 밀리면 안 된다 — 닫힌 행을 다시 쓰지 않는다")
                .isEqualTo(closedAt);
    }

    @Test
    @DisplayName("남의 명령은 닫지 못하고, 「없음」과 구분되지도 않는다 — 존재 노출을 만들지 않는다")
    void otherUsersCommandCannotBeClosedAndLooksIdenticalToMissing() {
        UUID owner = UUID.randomUUID();
        UUID stranger = UUID.randomUUID();
        UUID outboxId = appendDeviceTokenDelete(owner);

        assertThatThrownBy(() -> ackPort.acknowledgeNotificationDelivery(stranger, outboxId))
                .isInstanceOf(OutboxException.class)
                .extracting(e -> ((OutboxException) e).getErrorCode())
                .isEqualTo(OutboxErrorCode.OUTBOX_DELIVERY_NOT_FOUND);

        assertThatThrownBy(() -> ackPort.acknowledgeNotificationDelivery(stranger, UUID.randomUUID()))
                .as("남의 것과 없는 것이 같은 코드로 나가야 명령 id 를 찔러 존재를 알아낼 수 없다")
                .isInstanceOf(OutboxException.class)
                .extracting(e -> ((OutboxException) e).getErrorCode())
                .isEqualTo(OutboxErrorCode.OUTBOX_DELIVERY_NOT_FOUND);

        assertThat(delivery(outboxId, OutboxTarget.NOTI).getDeliveredAt()).isNull();
    }

    @Test
    @DisplayName("알림 대상이 없는 명령은 닫히지 않는다 — Kafka·링크 전달이 이 경로로 표시되면 안 된다")
    void doesNotCloseKafkaOrLinkTargets() {
        UUID userId = UUID.randomUUID();
        UUID outboxId = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                "evt-ack-nonoti-" + UUID.randomUUID(), 1, "challenge.created", userId, "ko", null,
                AggregateRef.ofUser(userId), null, Map.of(),
                List.of(OutboxDeliveryRequest.toKafka(),
                        OutboxDeliveryRequest.toLink("LINK_USER_WITHDRAW", null)))).eventId())
                .transform(this::outboxIdOf);

        assertThatThrownBy(() -> ackPort.acknowledgeNotificationDelivery(userId, outboxId))
                .isInstanceOf(OutboxException.class);

        assertThat(delivery(outboxId, OutboxTarget.KAFKA).getDeliveredAt())
                .as("대상이 인자였다면 이 경로로 브로커 전달까지 「보냈다」고 표시할 수 있었다").isNull();
        assertThat(delivery(outboxId, OutboxTarget.LINK).getDeliveredAt()).isNull();
    }

    @Test
    @DisplayName("먼저 실패해 남아 있는 다른 대상은 건드리지 않는다 — relay 가 계속 재시도해야 한다")
    void leavesOtherFailedTargetsAlone() {
        UUID userId = UUID.randomUUID();
        UUID outboxId = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                "evt-ack-mixed-" + UUID.randomUUID(), 1, "device.token.deleted", userId, "ko", null,
                AggregateRef.ofUser(userId), null, Map.of("deviceToken", "t"),
                List.of(OutboxDeliveryRequest.toKafka(),
                        OutboxDeliveryRequest.toNotification("NOTI_DEVICE_TOKEN_DELETE", null)))).eventId())
                .transform(this::outboxIdOf);

        // 브로커 전달이 이미 한 번 실패해 남아 있는 상태.
        UUID relayToken = UUID.randomUUID();
        tx().executeWithoutResult(status -> {
            EventOutboxDelivery kafka = delivery(outboxId, OutboxTarget.KAFKA);
            deliveryRepository.claimBatch(OutboxTarget.KAFKA.name(), Instant.now(),
                    Instant.now().plusSeconds(60), "relay", relayToken, 10);
            deliveryRepository.markFailed(kafka.getId(), relayToken,
                    Instant.now().plusSeconds(30), "브로커 순단");
        });

        ackPort.acknowledgeNotificationDelivery(userId, outboxId);

        assertThat(delivery(outboxId, OutboxTarget.NOTI).getDeliveredAt()).isNotNull();
        EventOutboxDelivery kafka = delivery(outboxId, OutboxTarget.KAFKA);
        assertThat(kafka.getDeliveredAt()).as("실패가 남은 대상은 그대로 재시도돼야 한다").isNull();
        assertThat(kafka.getLastError()).isEqualTo("브로커 순단");
    }

    @Test
    @DisplayName("relay 가 리스를 쥔 채여도 닫히고, 그 워커의 뒤늦은 성공·실패 표시는 거부된다")
    void closesEvenWhileLeasedAndStaleRelayMarksAreRejected() {
        UUID userId = UUID.randomUUID();
        UUID outboxId = appendDeviceTokenDelete(userId);
        UUID deliveryId = delivery(outboxId, OutboxTarget.NOTI).getId();

        UUID relayToken = UUID.randomUUID();
        tx().executeWithoutResult(status -> deliveryRepository.claimBatch(
                OutboxTarget.NOTI.name(), Instant.now(), Instant.now().plusSeconds(60),
                "relay", relayToken, 10));
        assertThat(delivery(outboxId, OutboxTarget.NOTI).getLeaseToken()).isEqualTo(relayToken);

        assertThat(ackPort.acknowledgeNotificationDelivery(userId, outboxId))
                .as("리스를 이유로 거부하면 직접 전달 성공이 기록될 자리가 없어진다")
                .isEqualTo(OutboxDeliveryAckPort.AckOutcome.MARKED);

        EventOutboxDelivery closed = delivery(outboxId, OutboxTarget.NOTI);
        Instant closedAt = closed.getDeliveredAt();
        assertThat(closedAt).isNotNull();
        assertThat(closed.getLeaseToken())
                .as("닫힌 행에 남은 리스는 「누가 아직 붙잡고 있다」는 거짓 신호다").isNull();

        int lateFailure = tx().execute(status -> deliveryRepository.markFailed(
                deliveryId, relayToken, Instant.now().plusSeconds(60), "늦은 실패"));
        assertThat(lateFailure)
                .as("낡은 relay 실패 표시가 닫힌 전달을 되살리면 중복 발송이 된다").isZero();
        int lateSuccess = tx().execute(status ->
                deliveryRepository.markDelivered(deliveryId, relayToken, Instant.now()));
        assertThat(lateSuccess)
                .as("낡은 relay 완료 표시도 반영되지 않는다 — 표시 시각이 흔들린다").isZero();

        EventOutboxDelivery after = delivery(outboxId, OutboxTarget.NOTI);
        assertThat(after.getDeliveredAt()).isEqualTo(closedAt);
        assertThat(after.getLastError()).isNull();
    }

    @Test
    @DisplayName("공개 eventId로 명령을 닫으며 내부 UUID 문자열 및 다른 사용자는 허용하지 않는다")
    void publicEventIdResolvesInternalIdWithoutWeakeningOwnership() {
        UUID owner = UUID.randomUUID();
        UUID id = appendDeviceTokenDelete(owner);
        String eventId = outboxRepository.findById(id).orElseThrow().getEventId();
        assertThatThrownBy(() -> ackPort.acknowledgeNotificationDelivery(owner, id.toString()))
                .isInstanceOf(OutboxException.class);
        assertThatThrownBy(() -> ackPort.acknowledgeNotificationDelivery(UUID.randomUUID(), eventId))
                .isInstanceOf(OutboxException.class);
        assertThat(delivery(id, OutboxTarget.NOTI).getDeliveredAt()).isNull();
        assertThat(ackPort.acknowledgeNotificationDelivery(owner, eventId))
                .isEqualTo(OutboxDeliveryAckPort.AckOutcome.MARKED);
        assertThat(ackPort.acknowledgeNotificationDelivery(owner, eventId))
                .isEqualTo(OutboxDeliveryAckPort.AckOutcome.ALREADY_MARKED);
    }

    // ── 헬퍼 ────────────────────────────────────────────────────────────

    private UUID appendDeviceTokenDelete(UUID userId) {
        EventEnvelope envelope = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                "evt-ack-" + UUID.randomUUID(), 1, "device.token.deleted", userId, "ko", null,
                AggregateRef.ofUser(userId), null, Map.of("deviceToken", "fcm-token"),
                List.of(OutboxDeliveryRequest.toNotification("NOTI_DEVICE_TOKEN_DELETE", null)))));
        return outboxIdOf(envelope.eventId());
    }

    private UUID outboxIdOf(String eventId) {
        return outboxRepository.findByEventId(eventId)
                .orElseThrow(() -> new AssertionError("봉투가 없습니다 — eventId=" + eventId))
                .getId();
    }

    private EventOutboxDelivery delivery(UUID outboxId, OutboxTarget target) {
        return deliveryRepository.findByOutboxIdAndTarget(outboxId, target)
                .orElseThrow(() -> new AssertionError("전달 행이 없습니다 — target=" + target));
    }
}
