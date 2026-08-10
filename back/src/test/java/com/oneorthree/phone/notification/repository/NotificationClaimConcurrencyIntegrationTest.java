package com.oneorthree.phone.notification.repository;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.notification.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 클레임 발송 선점의 <b>동시성</b> 계약(GROMO-1417 · codex P2) — 트랜잭션 두 개가 겹쳐야 드러나는
 * 성질이라 {@code @Transactional} 없는 통합 테스트로 잠근다.
 *
 * <p>보는 것: 5분 flush 크론과 수동 {@code /notify-results} 가 동시에 돌 때
 * {@code findDueClaimsForUpdate} 가 <b>한 워커에게만</b> 행을 넘긴다. 잠금·CAS 없이 둘 다 읽으면
 * 같은 이월 알림이 <b>중복 도착</b>한다 — {@code FOR UPDATE SKIP LOCKED} 가 그걸 막는다.
 */
class NotificationClaimConcurrencyIntegrationTest extends IntegrationTestBase {

    private static final Instant NOW = Instant.parse("2026-08-02T03:00:00Z");

    @Autowired
    NotificationSentLogRepository notificationSentLogRepository;
    @Autowired
    TransactionTemplate transactionTemplate;

    private final List<UUID> seeded = new java.util.ArrayList<>();

    @AfterEach
    void cleanUp() {
        transactionTemplate.executeWithoutResult(status ->
                notificationSentLogRepository.deleteByIds(seeded));
    }

    private UUID seedDeferredClaim() {
        UUID rowId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        transactionTemplate.executeWithoutResult(status -> {
            notificationSentLogRepository.insertPendingClaim(rowId, userId,
                    NotificationSentLog.TYPE_BET_RESULT, sessionId, UUID.randomUUID(), NOW, NOW);
            notificationSentLogRepository.updateStatusByIds(
                    List.of(rowId), NotificationSendStatus.DEFERRED, null);
        });
        seeded.add(rowId);
        return rowId;
    }

    @Test
    @DisplayName("두 워커가 동시에 flush 하면 한쪽만 행을 가져간다 (FOR UPDATE SKIP LOCKED)")
    void concurrentFlushesDoNotSeeTheSameClaim() throws Exception {
        UUID rowId = seedDeferredClaim();
        CountDownLatch firstHoldsLock = new CountDownLatch(1);
        CountDownLatch secondFinished = new CountDownLatch(1);

        // 워커 A — 행을 잠근 채 B 가 조회를 끝낼 때까지 트랜잭션을 붙잡는다.
        CompletableFuture<Integer> workerA = CompletableFuture.supplyAsync(() ->
                transactionTemplate.execute(status -> {
                    List<NotificationSentLog> rows = notificationSentLogRepository
                            .findDueClaimsForUpdate(
                                    List.of(NotificationSentLog.TYPE_BET_RESULT), NOW, NOW);
                    firstHoldsLock.countDown();
                    try {
                        secondFinished.await(10, TimeUnit.SECONDS);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    return (int) rows.stream().filter(r -> r.getId().equals(rowId)).count();
                }));

        assertThat(firstHoldsLock.await(10, TimeUnit.SECONDS)).isTrue();

        // 워커 B — 같은 조건으로 조회. 잠긴 행은 건너뛰어야 한다(대기도 하지 않는다).
        int seenByB = transactionTemplate.execute(status -> (int) notificationSentLogRepository
                .findDueClaimsForUpdate(List.of(NotificationSentLog.TYPE_BET_RESULT), NOW, NOW)
                .stream().filter(r -> r.getId().equals(rowId)).count());
        secondFinished.countDown();

        assertThat(workerA.get(15, TimeUnit.SECONDS))
                .as("먼저 잠근 워커는 행을 가져간다").isEqualTo(1);
        assertThat(seenByB)
                .as("동시에 도는 워커는 잠긴 행을 건너뛴다 — 안 그러면 같은 알림이 두 번 나간다").isZero();
    }
}
