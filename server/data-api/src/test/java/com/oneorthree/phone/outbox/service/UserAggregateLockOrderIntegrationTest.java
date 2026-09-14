package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.notification.producer.NotificationEventKey;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationOutboxProducer;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.outbox.support.PostgresLockWaits;
import com.oneorthree.phone.outbox.support.RawUserLock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * USER aggregate 잠금의 정본 순서 — 실물 PostgreSQL 두 트랜잭션으로 본다 (GROMO-893).
 *
 * <p>CI 프로파일은 {@code outbox.user-lock-order.enforce=true} 다. 짝이 되는 교착 재현(정본 순서가 없던 모양)은
 * 감시를 끈 {@link UserAggregateLockOrderLenientIntegrationTest} 에 있다.
 */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
class UserAggregateLockOrderIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired AggregateVersionAllocator allocator;
    @Autowired NotificationOutboxProducer producer;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactions);
    }

    /** @return 정본(문자열) 순서로 정렬한 사용자 {@code count} 명 */
    private static List<UUID> canonicalUsers(int count) {
        return Stream.generate(UUID::randomUUID).limit(count)
                .sorted((left, right) -> left.toString().compareTo(right.toString()))
                .toList();
    }

    private static NotificationRequest deadline(UUID user, Instant occurredAt) {
        return new NotificationRequest(NotificationKind.LEAGUE_DEADLINE, user, null, null, null, occurredAt, "ko",
                Map.of("rank", 1));
    }

    /**
     * 짝 테스트({@code UserAggregateLockOrderLenientIntegrationTest#perRecipientLockingInCallerOrderDeadlocks})와
     * <b>같은 순서로</b> 두 트랜잭션을 엇갈리게 세운다. 수신자 순서가 반대인 두 fan-out 이 서로를 기다리는 순간을
     * 실제로 만들고, 정본 순서로 한 번에 잠그면 한쪽이 끝날 때까지 기다릴 뿐 순환이 생기지 않음을 본다.
     */
    @Test
    @DisplayName("수신자 순서가 반대인 두 fan-out 이 엇갈려도 교착 없이 둘 다 커밋된다")
    void reverseRecipientOrdersWaitInsteadOfDeadlocking() throws Exception {
        List<UUID> users = canonicalUsers(2);
        UUID low = users.get(0);
        UUID high = users.get(1);
        PostgresLockWaits.ensureUserRows(jdbc, users);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (RawUserLock other = RawUserLock.open()) {
            other.lock(high);
            // 첫 트랜잭션은 [high, low] 순서로 넘긴다 — 정본 순서라면 low 를 먼저 쥐고 high 에서 기다린다.
            Future<?> first = pool.submit(() -> tx().executeWithoutResult(status -> producer.appendAll(List.of(
                    deadline(high, Instant.parse("2026-11-01T11:00:00Z")),
                    deadline(low, Instant.parse("2026-11-01T11:00:00Z"))))));
            PostgresLockWaits.awaitWaiting(jdbc, 1);
            Future<?> second = pool.submit(() -> tx().executeWithoutResult(status -> producer.appendAll(List.of(
                    deadline(low, Instant.parse("2026-11-02T11:00:00Z")),
                    deadline(high, Instant.parse("2026-11-02T11:00:00Z"))))));
            PostgresLockWaits.awaitWaiting(jdbc, 2);
            other.commit();

            first.get(30, TimeUnit.SECONDS);
            second.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        // 사용자마다 먼저 커밋한 트랜잭션(11-01 사건)의 version 이 뒤 트랜잭션(11-02 사건)보다 작다 — 기다린 쪽이 뒤에 적었다.
        for (UUID user : users) {
            assertThat(jdbc.queryForList("SELECT event_id FROM event_outbox WHERE user_id=? ORDER BY version",
                    String.class, user)).containsExactly(
                    NotificationEventKey.of(NotificationKind.LEAGUE_DEADLINE, user, null,
                            Instant.parse("2026-11-01T11:00:00Z")),
                    NotificationEventKey.of(NotificationKind.LEAGUE_DEADLINE, user, null,
                            Instant.parse("2026-11-02T11:00:00Z")));
        }
    }

    @Test
    @DisplayName("정본 순서를 거스르는 획득은 CI 에서 잠그기 전에 실패한다 — 이미 쥔 행과 뒤쪽 행은 통과한다")
    void outOfOrderAcquisitionFailsLoudlyBeforeLocking() {
        List<UUID> users = canonicalUsers(3);
        tx().executeWithoutResult(status -> {
            allocator.allocate(AggregateRef.ofUser(users.get(1)));
            assertThatThrownBy(() -> allocator.allocate(AggregateRef.ofUser(users.get(0))))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("잠금 순서 위반");
            assertThatThrownBy(() -> allocator.lockUsers(List.of(users.get(0), users.get(2))))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("잠금 순서 위반");
            // 이미 쥔 행을 다시 발급하거나 뒤쪽 행을 잡는 것은 순서를 거스르지 않는다.
            assertThat(allocator.allocate(AggregateRef.ofUser(users.get(1)))).isEqualTo(2L);
            allocator.lockUsers(List.of(users.get(2), users.get(1)));
            status.setRollbackOnly();
        });
    }

    @Test
    @DisplayName("REQUIRES_NEW 로 열린 안쪽 트랜잭션은 바깥이 쥔 잠금을 자기 것으로 세지 않는다")
    void anInnerTransactionKeepsItsOwnLedger() {
        List<UUID> users = canonicalUsers(2);
        TransactionTemplate inner = tx();
        inner.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        tx().executeWithoutResult(outer -> {
            allocator.allocate(AggregateRef.ofUser(users.get(1)));
            inner.executeWithoutResult(status -> {
                allocator.allocate(AggregateRef.ofUser(users.get(0)));
                status.setRollbackOnly();
            });
            outer.setRollbackOnly();
        });
    }
}
