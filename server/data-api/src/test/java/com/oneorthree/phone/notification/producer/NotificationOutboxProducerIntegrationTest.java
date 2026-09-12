package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 알림 사건 producer 의 <b>실제 생산 배선</b> 검증 — 실물 PostgreSQL + 실제 Flyway.
 *
 * <p>목으로 세울 수 없는 성질만 본다: 결정적 키의 UNIQUE 가 실제로 작동하는가, 같은 키가
 * <b>동시에</b> 들어와도 도메인 트랜잭션을 죽이지 않는가, 트랜잭션 밖 호출이 막히는가.
 */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
class NotificationOutboxProducerIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    NotificationOutboxProducer producer;
    @Autowired
    NotificationDispatcher dispatcher;
    @Autowired
    EventOutboxRepository outboxRepository;
    @Autowired
    EventOutboxDeliveryRepository deliveryRepository;
    @Autowired
    PlatformTransactionManager transactionManager;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private static NotificationRequest betResult(UUID userId, UUID sessionId) {
        return new NotificationRequest(NotificationKind.BET_RESULT, userId, sessionId,
                UUID.randomUUID(), Instant.parse("2026-09-11T03:00:00Z"), null, "ko",
                Map.of("challengeId", UUID.randomUUID().toString(), "stake", 100,
                        "betStatus", "SETTLED", "achieved", true, "payout", 250));
    }

    @Test
    @DisplayName("사건을 적으면 Kafka 전달 한 건과 함께 남고, params 에 kind·quietPolicy·묶음 메타가 실린다")
    void appendWritesEnvelopeWithKafkaDelivery() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        NotificationRequest request = betResult(userId, sessionId);

        EventEnvelope envelope = tx().execute(status -> producer.append(request).orElseThrow());

        assertThat(envelope.type()).isEqualTo(NotificationOutboxProducer.EVENT_TYPE);
        assertThat(envelope.userId()).isEqualTo(userId);
        assertThat(envelope.subjectId()).isEqualTo(sessionId.toString());
        // 이월은 «발행»이 아니라 «발송»을 미루는 일이라 relay 를 붙잡지 않는다.
        assertThat(envelope.scheduledAt()).isNull();
        assertThat(envelope.params())
                .containsEntry("kind", "BET_RESULT")
                .containsEntry("quietPolicy", "DEFER")
                .containsEntry("payout", 250)
                .containsKey("groupId")
                .containsKey("slotAt");

        EventOutbox saved = outboxRepository.findByEventId(envelope.eventId()).orElseThrow();
        List<EventOutboxDelivery> deliveries = deliveryRepository.findAll().stream()
                .filter(delivery -> delivery.getOutboxId().equals(saved.getId()))
                .toList();
        assertThat(deliveries).singleElement()
                .satisfies(delivery -> assertThat(delivery.getTarget()).isEqualTo(OutboxTarget.KAFKA));
    }

    private static NotificationRequest friendRequest(UUID userId, UUID counterpartId, Instant occurredAt) {
        return new NotificationRequest(NotificationKind.FRIEND_REQUEST, userId, counterpartId, null, null,
                occurredAt, "ko", Map.of("counterpartUserId", counterpartId.toString(),
                        "counterpartNickname", "친구", "requestId", UUID.randomUUID().toString()));
    }

    /**
     * 분 축은 달력상의 분으로 절삭한 <b>고정 버킷</b>이지 «최근 1분»이 아니다. 버전 필드가 없는 친구
     * 요청의 재개·수락은 동시에 처리된 둘이 각자 자기 {@code updatedAt} 을 쓰므로, 그 둘이
     * {@code 12:00:59} 와 {@code 12:01:01} 로 갈리면 서로 다른 키가 되어 <b>outbox 두 행 · 푸시 두 번</b>이
     * 나간다. 어느 쪽이 먼저 적히든 접혀야 한다 — 잠금이 직렬화하는 것은 순서지 시각이 아니다.
     */
    @Test
    @DisplayName("분 경계에 걸친 같은 친구 사건은 한 건으로 접힌다 — 어느 쪽이 먼저 와도")
    void aFriendEventStraddlingTheMinuteBoundaryStaysOneEvent() {
        UUID userId = UUID.randomUUID();
        UUID counterpart = UUID.randomUUID();
        Instant justBefore = Instant.parse("2026-09-11T12:00:59Z");
        Instant justAfter = Instant.parse("2026-09-11T12:01:01Z");

        Optional<EventEnvelope> before = tx().execute(status ->
                producer.append(friendRequest(userId, counterpart, justBefore)));
        Optional<EventEnvelope> after = tx().execute(status ->
                producer.append(friendRequest(userId, counterpart, justAfter)));
        assertThat(before).isPresent();
        assertThat(after).isEmpty();

        // 반대 순서도 같다 — 잠금이 직렬화하는 것은 «순서»지 «시각»이 아니다.
        UUID other = UUID.randomUUID();
        Optional<EventEnvelope> laterFirst = tx().execute(status ->
                producer.append(friendRequest(other, counterpart, justAfter)));
        Optional<EventEnvelope> earlierSecond = tx().execute(status ->
                producer.append(friendRequest(other, counterpart, justBefore)));
        assertThat(laterFirst).isPresent();
        assertThat(earlierSecond).isEmpty();

        assertThat(outboxRepository.findAll().stream()
                .filter(row -> userId.equals(row.getUserId()) || other.equals(row.getUserId()))
                .toList()).hasSize(2);
    }

    @Test
    @DisplayName("몇 분 떨어진 친구 사건은 별개다 — 폭이 넓어지면 다시 보낸 요청의 통보가 사라진다")
    void friendEventsMinutesApartStayDistinct() {
        UUID userId = UUID.randomUUID();
        UUID counterpart = UUID.randomUUID();
        Instant at = Instant.parse("2026-09-11T12:00:59Z");

        Optional<EventEnvelope> first = tx().execute(status ->
                producer.append(friendRequest(userId, counterpart, at)));
        Optional<EventEnvelope> second = tx().execute(status ->
                producer.append(friendRequest(userId, counterpart, at.plusSeconds(180))));
        assertThat(first).isPresent();
        assertThat(second).isPresent();

        assertThat(outboxRepository.findAll().stream()
                .filter(row -> userId.equals(row.getUserId()))
                .toList()).hasSize(2);
    }

    @Test
    @DisplayName("같은 결정적 키를 다시 적으면 조용히 건너뛴다 — 재훑기·겹치는 크론의 정상 동작이다")
    void duplicateDeterministicKeyIsSkipped() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();

        Optional<EventEnvelope> first = tx().execute(status -> producer.append(betResult(userId, sessionId)));
        Optional<EventEnvelope> second = tx().execute(status -> producer.append(betResult(userId, sessionId)));

        assertThat(first).isPresent();
        // 예외가 아니다 — 예외면 재훑기가 매 15분 도메인 트랜잭션을 죽인다.
        assertThat(second).isEmpty();
        assertThat(outboxRepository.findAll().stream()
                .filter(row -> userId.equals(row.getUserId()))
                .toList()).hasSize(1);
    }

    @Test
    @DisplayName("같은 키가 동시에 들어와도 한 건만 남고 어느 트랜잭션도 UNIQUE 위반으로 죽지 않는다")
    void concurrentSameKeyDoesNotBlowUpEitherTransaction() throws Exception {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(2);
        AtomicReference<Throwable> failure = new AtomicReference<>();

        Runnable task = () -> {
            try {
                start.await();
                tx().execute(status -> producer.append(betResult(userId, sessionId)));
            } catch (Throwable t) {
                failure.compareAndSet(null, t);
            } finally {
                done.countDown();
            }
        };
        Thread one = new Thread(task, "producer-1");
        Thread two = new Thread(task, "producer-2");
        one.start();
        two.start();
        start.countDown();
        assertThat(done.await(30, TimeUnit.SECONDS)).isTrue();
        one.join();
        two.join();

        // 조회와 삽입 사이를 잠그지 않으면 둘 다 「없다」를 보고 둘 다 INSERT 해서, 한쪽이
        // UNIQUE 위반으로 «도메인 트랜잭션 전체»를 되돌린다 — 중복 알림 하나를 막으려다
        // 정산·친구 요청이 롤백된다.
        assertThat(failure.get()).isNull();
        assertThat(outboxRepository.findAll().stream()
                .filter(row -> userId.equals(row.getUserId()))
                .toList()).hasSize(1);
    }

    @Test
    @DisplayName("트랜잭션 밖에서 적으려 하면 죽는다 — 도메인이 롤백돼도 알림만 남는 반대 방향 유실을 막는다")
    void appendOutsideTransactionFails() {
        assertThatThrownBy(() -> producer.append(betResult(UUID.randomUUID(), UUID.randomUUID())))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    @DisplayName("OUTBOX 모드에서 dispatcher 는 FCM 을 부르지 않고 사건만 적는다")
    void outboxModeQueuesInsteadOfSending() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();

        NotificationDispatchOutcome first = tx().execute(status ->
                dispatcher.enqueueOnly(betResult(userId, sessionId)));
        NotificationDispatchOutcome again = tx().execute(status ->
                dispatcher.enqueueOnly(betResult(userId, sessionId)));

        assertThat(dispatcher.isOutboxMode()).isTrue();
        assertThat(first).isEqualTo(NotificationDispatchOutcome.QUEUED);
        assertThat(again).isEqualTo(NotificationDispatchOutcome.DUPLICATE);
        // 신 경로는 «보낸 것» 이 아니므로 구 sent_log 를 건드릴 권한이 없다.
        assertThat(first.recordsLegacyLog()).isFalse();
        assertThat(again.recordsLegacyLog()).isFalse();
    }
}
