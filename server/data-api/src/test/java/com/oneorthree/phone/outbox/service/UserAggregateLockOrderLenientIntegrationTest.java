package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.outbox.support.PostgresLockWaits;
import com.oneorthree.phone.outbox.support.RawUserLock;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 감시를 끈 채(운영 기본값) 정본 순서가 <b>없던</b> 모양을 실물 PostgreSQL 에서 재현한다 (GROMO-893).
 *
 * <p>{@link UserAggregateLockOrderIntegrationTest#reverseRecipientOrdersWaitInsteadOfDeadlocking} 과 같은 엇갈림에서
 * 수신자마다 호출 순서대로 하나씩 잠그면 PostgreSQL 이 한쪽을 {@code 40P01} 로 끊는다 — 짝 테스트가 공허하지 않다는 증거다.
 */
@SpringBootTest(properties = {"notification.dispatch.mode=OUTBOX", "outbox.user-lock-order.enforce=false"})
class UserAggregateLockOrderLenientIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired AggregateVersionAllocator allocator;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @Autowired MeterRegistry meterRegistry;

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactions);
    }

    private static List<UUID> canonicalUsers(int count) {
        return Stream.generate(UUID::randomUUID).limit(count)
                .sorted((left, right) -> left.toString().compareTo(right.toString()))
                .toList();
    }

    @Test
    @DisplayName("수신자마다 호출 순서대로 잠그면 반대 순서의 트랜잭션과 교착해 한쪽이 40P01 로 롤백된다")
    void perRecipientLockingInCallerOrderDeadlocks() throws Exception {
        List<UUID> users = canonicalUsers(2);
        UUID low = users.get(0);
        UUID high = users.get(1);
        PostgresLockWaits.ensureUserRows(jdbc, users);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<Throwable> failures = new ArrayList<>();
        int committed = 0;
        try (RawUserLock other = RawUserLock.open()) {
            other.lock(high);
            Future<?> first = pool.submit(() -> tx().executeWithoutResult(status -> {
                allocator.allocate(AggregateRef.ofUser(high));
                allocator.allocate(AggregateRef.ofUser(low));
            }));
            PostgresLockWaits.awaitWaiting(jdbc, 1);
            Future<?> second = pool.submit(() -> tx().executeWithoutResult(status -> {
                allocator.allocate(AggregateRef.ofUser(low));
                allocator.allocate(AggregateRef.ofUser(high));
            }));
            PostgresLockWaits.awaitWaiting(jdbc, 2);
            other.commit();
            for (Future<?> future : List.of(first, second)) {
                try {
                    future.get(30, TimeUnit.SECONDS);
                    committed++;
                } catch (ExecutionException failed) {
                    failures.add(failed.getCause());
                }
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(committed).isEqualTo(1);
        assertThat(failures).singleElement()
                .satisfies(failure -> assertThat(PostgresLockWaits.sqlStateOf(failure)).isEqualTo("40P01"));
    }

    @Test
    @DisplayName("운영 기본값에서는 순서 위반을 막지 않고 경고 로그와 지표로 남긴다")
    void outOfOrderAcquisitionIsCountedWhenNotEnforced() {
        List<UUID> users = canonicalUsers(2);
        double before = meterRegistry.counter(UserAggregateLockOrderGuard.VIOLATION_METRIC).count();
        tx().executeWithoutResult(status -> {
            allocator.allocate(AggregateRef.ofUser(users.get(1)));
            allocator.allocate(AggregateRef.ofUser(users.get(0)));
            status.setRollbackOnly();
        });
        assertThat(meterRegistry.counter(UserAggregateLockOrderGuard.VIOLATION_METRIC).count()).isEqualTo(before + 1);
    }
}
