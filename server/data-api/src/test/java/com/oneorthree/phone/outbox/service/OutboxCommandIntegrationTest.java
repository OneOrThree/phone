package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.IdempotencyRequest;
import com.oneorthree.phone.outbox.dto.IdempotentOutcome;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
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
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 내구 이벤트·명령 기반의 <b>실제 생산 배선</b> 검증 (A21, GROMO-1659·1660 공통).
 *
 * <p>실물 PostgreSQL + <b>실제 Flyway V51</b> 위에서 돈다({@code ddl-auto=validate}) — 수동 DDL 이
 * 마이그레이션을 대신하지 않고, 목이 생산 경로를 대신 세우지도 않는다. 검증 대상은 스프링이 조립한
 * {@link OutboxCommandPort} 그 자체다.
 *
 * <p>relay 는 <b>꺼진 채</b>다(기본값). 꺼진 기동에서도 봉투가 남는지까지 함께 본다 — 그게 「나중에
 * 켜면 밀린 분이 나간다」의 전제다.
 */
@SpringBootTest
class OutboxCommandIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    OutboxCommandPort outboxCommandPort;
    @Autowired
    EventOutboxRepository outboxRepository;
    @Autowired
    EventOutboxDeliveryRepository deliveryRepository;
    @Autowired
    PlatformTransactionManager transactionManager;
    @Autowired
    ApplicationContext applicationContext;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    @Test
    @DisplayName("트랜잭션 밖의 append 는 거부된다 — 도메인 커밋과 함께 남는 것이 계약이다")
    void appendOutsideTransactionIsRejected() {
        assertThatThrownBy(() -> outboxCommandPort.append(command(UUID.randomUUID(), "evt-outside")))
                .as("밖에서 불리면 별도 트랜잭션으로 커밋돼, 도메인이 롤백돼도 이벤트만 남는다")
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    @DisplayName("도메인이 롤백되면 봉투도 전달 행도 남지 않는다 — 같은 트랜잭션이라는 뜻이 이것이다")
    void rollbackRemovesEnvelopeAndDeliveries() {
        UUID userId = UUID.randomUUID();
        String eventId = "evt-rollback-" + UUID.randomUUID();

        assertThatThrownBy(() -> tx().executeWithoutResult(status -> {
            outboxCommandPort.append(command(userId, eventId));
            throw new IllegalStateException("도메인 실패");
        })).hasMessage("도메인 실패");

        assertThat(outboxRepository.findByEventId(eventId)).isEmpty();
    }

    @Test
    @DisplayName("요구한 대상마다 전달 행이 하나씩 생기고, payload 를 안 주면 정본 봉투가 실린다")
    void createsOneDeliveryPerTargetWithEnvelopeAsDefaultPayload() {
        UUID userId = UUID.randomUUID();
        String eventId = "evt-targets-" + UUID.randomUUID();

        EventEnvelope envelope = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                eventId, 1, "user.withdrawn", userId, "ko", null,
                AggregateRef.ofUser(userId), null, Map.of("reason", "SELF"),
                List.of(OutboxDeliveryRequest.toKafka(),
                        OutboxDeliveryRequest.toLink("LINK_USER_WITHDRAW", null),
                        OutboxDeliveryRequest.toNotification("NOTI_USER_WITHDRAW",
                                Map.of("userId", userId.toString()))))));

        EventOutbox saved = outboxRepository.findByEventId(eventId).orElseThrow();
        assertThat(saved.getVersion()).isEqualTo(envelope.version());
        assertThat(saved.getAggregateType()).isEqualTo(AggregateRef.TYPE_USER);

        List<EventOutboxDelivery> deliveries = deliveryRepository.findByOutboxId(saved.getId());
        assertThat(deliveries).hasSize(3);
        assertThat(deliveries).allSatisfy(delivery -> {
            assertThat(delivery.getDeliveredAt()).as("아직 아무 대상에도 안 갔다").isNull();
            assertThat(delivery.getAttemptCount()).isZero();
            assertThat(delivery.getAggregateVersion()).isEqualTo(envelope.version());
        });

        EventOutboxDelivery kafka = delivery(saved.getId(), OutboxTarget.KAFKA);
        assertThat(kafka.getEndpointKey()).as("브로커는 URL 을 갖지 않는다").isNull();
        assertThat(kafka.getPayload())
                .containsEntry("eventId", eventId)
                .containsEntry("type", "user.withdrawn")
                .containsEntry("locale", "ko")
                .containsEntry("params", Map.of("reason", "SELF"));

        EventOutboxDelivery noti = delivery(saved.getId(), OutboxTarget.NOTI);
        assertThat(noti.getEndpointKey()).isEqualTo("NOTI_USER_WITHDRAW");
        assertThat(noti.getPayload())
                .as("대상별 본문을 주면 그것이 저장된다 — 재전달이 도메인 상태를 다시 읽지 않게")
                .isEqualTo(Map.of("userId", userId.toString()));
    }

    @Test
    @DisplayName("version 은 축별로 1부터 단조 증가하고, 다른 축은 서로 독립이다")
    void versionsAreMonotonePerAggregateAxis() {
        UUID userId = UUID.randomUUID();
        UUID groupId = UUID.randomUUID();

        long first = tx().execute(status -> outboxCommandPort.append(
                command(userId, "evt-v1-" + UUID.randomUUID())).version());
        long second = tx().execute(status -> outboxCommandPort.append(
                command(userId, "evt-v2-" + UUID.randomUUID())).version());
        long linkFirst = tx().execute(status -> outboxCommandPort.append(new OutboxAppendCommand(
                "evt-link-" + UUID.randomUUID(), 1, "link.revoked", userId, null, groupId.toString(),
                AggregateRef.ofLinkMembership(groupId, userId), null, Map.of(),
                List.of(OutboxDeliveryRequest.toLink("LINK_REVOKE", null)))).version());

        assertThat(first).isEqualTo(1L);
        assertThat(second).isEqualTo(2L);
        assertThat(linkFirst)
                .as("링크 멤버십 전이는 유저와 다른 축이다 — 유저 번호를 물려받으면 ㋥ 의 전이 순서가 깨진다")
                .isEqualTo(1L);
    }

    @Test
    @DisplayName("같은 축의 두 트랜잭션은 version 발급에서 직렬화된다 — 번호 순서가 곧 커밋 순서다")
    void concurrentAppendsOnSameAxisSerializeUnderRowLock() throws Exception {
        UUID userId = UUID.randomUUID();
        CountDownLatch firstAppended = new CountDownLatch(1);
        CountDownLatch secondFinished = new CountDownLatch(1);
        AtomicLong firstVersion = new AtomicLong();
        AtomicLong secondVersion = new AtomicLong();
        AtomicLong firstCommitNanos = new AtomicLong();
        AtomicLong secondCommitNanos = new AtomicLong();

        Thread holder = new Thread(() -> tx().executeWithoutResult(status -> {
            firstVersion.set(outboxCommandPort.append(command(userId, "evt-race-1")).version());
            firstAppended.countDown();
            sleep(700);            // 잠금을 쥔 채 «늦게» 커밋한다
            firstCommitNanos.set(System.nanoTime());
        }));

        Thread follower = new Thread(() -> {
            awaitLatch(firstAppended);
            sleep(100);            // 앞 트랜잭션이 확실히 잠금을 쥔 뒤에 들어간다
            tx().executeWithoutResult(status -> {
                secondVersion.set(outboxCommandPort.append(command(userId, "evt-race-2")).version());
                secondCommitNanos.set(System.nanoTime());
            });
            secondFinished.countDown();
        });

        holder.start();
        follower.start();
        holder.join(30_000);
        assertThat(secondFinished.await(30, TimeUnit.SECONDS)).isTrue();

        assertThat(firstVersion.get()).isEqualTo(1L);
        assertThat(secondVersion.get())
                .as("시퀀스였다면 둘째가 먼저 번호를 받고 먼저 커밋할 수 있었다 — 그러면 최신 상태가 폐기된다")
                .isEqualTo(2L);
        assertThat(secondCommitNanos.get())
                .as("작은 번호가 «먼저» 커밋됐다는 것이 이 잠금이 사는 이유다")
                .isGreaterThan(firstCommitNanos.get());
    }

    @Test
    @DisplayName("같은 멱등 키의 재시도는 명령을 다시 실행하지 않고 같은 봉투를 재생한다")
    void replaysStoredResponseForSameIdempotencyKey() {
        UUID userId = UUID.randomUUID();
        String key = "idem-" + UUID.randomUUID();
        AtomicInteger executions = new AtomicInteger();
        AtomicReference<String> eventId = new AtomicReference<>("evt-idem-" + UUID.randomUUID());

        IdempotentOutcome<StoredResponse> first = tx().execute(status ->
                outboxCommandPort.runIdempotent(request(key, userId), StoredResponse.class,
                        () -> {
                            executions.incrementAndGet();
                            EventEnvelope envelope = outboxCommandPort.append(command(userId, eventId.get()));
                            return new StoredResponse(envelope.eventId(), envelope.version());
                        }));

        // 두 번째 호출은 «첫 응답을 못 받은 앱의 재시도»다 — 새 eventId 를 만들려 해도 실행되지 않아야 한다.
        eventId.set("evt-idem-second-" + UUID.randomUUID());
        IdempotentOutcome<StoredResponse> second = tx().execute(status ->
                outboxCommandPort.runIdempotent(request(key, userId), StoredResponse.class,
                        () -> {
                            executions.incrementAndGet();
                            EventEnvelope envelope = outboxCommandPort.append(command(userId, eventId.get()));
                            return new StoredResponse(envelope.eventId(), envelope.version());
                        }));

        assertThat(executions.get()).as("두 번째 POST 가 새 도메인 객체와 새 outbox 행을 만들면 안 된다").isEqualTo(1);
        assertThat(first.replayed()).isFalse();
        assertThat(second.replayed()).isTrue();
        assertThat(second.value())
                .as("재시도도 같은 봉투를 얻는다 — eventId 와 version 이 그대로다(A21)")
                .isEqualTo(first.value());
        assertThat(outboxRepository.findByEventId(eventId.get())).isEmpty();
    }

    @Test
    @DisplayName("같은 키로 다른 본문이 오면 재생하지 않고 거부한다 — 남의 응답을 재생받으면 유실과 구분되지 않는다")
    void rejectsSameKeyWithDifferentFingerprint() {
        UUID userId = UUID.randomUUID();
        String key = "idem-conflict-" + UUID.randomUUID();

        tx().execute(status -> outboxCommandPort.runIdempotent(
                new IdempotencyRequest(key, userId, "createChallenge", "fingerprint-a"),
                StoredResponse.class, () -> new StoredResponse("a", 1L)));

        assertThatThrownBy(() -> tx().execute(status -> outboxCommandPort.runIdempotent(
                new IdempotencyRequest(key, userId, "createChallenge", "fingerprint-b"),
                StoredResponse.class, () -> new StoredResponse("b", 2L))))
                .isInstanceOf(OutboxException.class)
                .extracting(e -> ((OutboxException) e).getErrorCode())
                .isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        for (IdempotencyRequest differentOwnerOrCommand : List.of(
                new IdempotencyRequest(key, userId, "anotherCommand", "fingerprint-a"))) {
            assertThatThrownBy(() -> tx().execute(status -> outboxCommandPort.runIdempotent(
                    differentOwnerOrCommand, StoredResponse.class, () -> {
                        throw new AssertionError("충돌한 명령은 실행하면 안 된다");
                    })))
                    .isInstanceOf(OutboxException.class)
                    .extracting(e -> ((OutboxException) e).getErrorCode())
                    .isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        }
    }

    @Test
    @DisplayName("두 사용자의 같은 멱등 헤더는 각각 실행되고 자기 응답만 재생한다")
    void idempotencyKeysAreScopedToTheRequestingUser() {
        String key = "shared-key";
        UUID firstUser = UUID.randomUUID();
        UUID secondUser = UUID.randomUUID();
        AtomicInteger executions = new AtomicInteger();
        for (UUID userId : List.of(firstUser, secondUser)) {
            IdempotentOutcome<StoredResponse> first = tx().execute(status ->
                    outboxCommandPort.runIdempotent(request(key, userId), StoredResponse.class, () -> {
                        executions.incrementAndGet();
                        return new StoredResponse(userId.toString(), 1L);
                    }));
            assertThat(first.replayed()).isFalse();
            IdempotentOutcome<StoredResponse> replay = tx().execute(status ->
                    outboxCommandPort.runIdempotent(request(key, userId), StoredResponse.class, () -> {
                        throw new AssertionError("같은 사용자의 재시도는 실행하지 않는다");
                    }));
            assertThat(replay.replayed()).isTrue();
            assertThat(replay.value()).isEqualTo(new StoredResponse(userId.toString(), 1L));
        }
        assertThat(executions.get()).isEqualTo(2);
    }

    @Test
    @DisplayName("명령이 롤백되면 멱등 기록도 함께 사라져 다음 시도가 정상적으로 실행된다")
    void rolledBackCommandLeavesNoIdempotencyRecord() {
        UUID userId = UUID.randomUUID();
        String key = "idem-rollback-" + UUID.randomUUID();
        AtomicInteger executions = new AtomicInteger();

        assertThatThrownBy(() -> tx().executeWithoutResult(status ->
                outboxCommandPort.runIdempotent(request(key, userId), StoredResponse.class, () -> {
                    executions.incrementAndGet();
                    throw new IllegalStateException("도메인 실패");
                }))).hasMessage("도메인 실패");

        IdempotentOutcome<StoredResponse> retry = tx().execute(status ->
                outboxCommandPort.runIdempotent(request(key, userId), StoredResponse.class, () -> {
                    executions.incrementAndGet();
                    return new StoredResponse("ok", 1L);
                }));

        assertThat(executions.get()).isEqualTo(2);
        assertThat(retry.replayed()).isFalse();
    }

    @Test
    @DisplayName("relay 가 꺼져 있어도 봉투는 남는다 — 켜면 그때 밀린 분이 나간다")
    void envelopesSurviveWhileRelayIsDisabled() {
        assertThat(applicationContext.getBeanNamesForType(OutboxRelayService.class))
                .as("기본값은 꺼짐이다 — 브로커도 위성도 없는 시점에 켜진 채 들어가면 기동이 타임아웃을 문다")
                .isEmpty();

        UUID userId = UUID.randomUUID();
        String eventId = "evt-disabled-" + UUID.randomUUID();
        tx().executeWithoutResult(status -> outboxCommandPort.append(command(userId, eventId)));

        EventOutbox saved = outboxRepository.findByEventId(eventId).orElseThrow();
        assertThat(delivery(saved.getId(), OutboxTarget.KAFKA).getDeliveredAt()).isNull();
    }

    // ── 헬퍼 ────────────────────────────────────────────────────────────

    /** 멱등 재생이 JSON 으로 왕복하는지까지 보기 위한 응답 타입. */
    record StoredResponse(String eventId, Long version) {
    }

    private static IdempotencyRequest request(String key, UUID userId) {
        return new IdempotencyRequest(key, userId, "createChallenge", "fingerprint-a");
    }

    private static OutboxAppendCommand command(UUID userId, String eventId) {
        return new OutboxAppendCommand(
                eventId, 1, "challenge.created", userId, "ko", null,
                AggregateRef.ofUser(userId), null, Map.of(),
                List.of(OutboxDeliveryRequest.toKafka()));
    }

    private EventOutboxDelivery delivery(UUID outboxId, OutboxTarget target) {
        Optional<EventOutboxDelivery> found = deliveryRepository.findByOutboxIdAndTarget(outboxId, target);
        return found.orElseThrow(() -> new AssertionError("전달 행이 없습니다 — target=" + target));
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private static void awaitLatch(CountDownLatch latch) {
        try {
            if (!latch.await(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException("선행 트랜잭션이 봉투를 적지 않았습니다 — 재현 전제가 깨졌다");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
