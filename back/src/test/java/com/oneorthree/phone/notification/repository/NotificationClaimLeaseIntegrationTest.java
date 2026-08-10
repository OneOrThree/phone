package com.oneorthree.phone.notification.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.notification.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 클레임 선점·리스(GROMO-1417, N41)의 실 DB 계약 — 파이프라인 dedup 의 토대라 SQL 레벨에서 잠근다.
 *
 * <p>보는 것: ① 같은 사건은 두 번 선점되지 않는다(ON CONFLICT DO NOTHING = 0), ② 같은 kind 라도
 * 회차가 다르면 별도 사건이다(N41), ③ 리스(10분)가 만료된 PENDING 만 재클레임된다 — 살아 있는
 * 리스·이미 SENT 는 못 뺏는다(죽은 워커 회수와 이중 발송 방지의 경계).
 */
class NotificationClaimLeaseIntegrationTest extends RepositoryTestBase {

    private static final Instant NOW = Instant.parse("2026-08-02T03:00:00Z");
    private static final Duration LEASE = Duration.ofMinutes(10);

    @Autowired
    NotificationSentLogRepository notificationSentLogRepository;

    @Test
    @DisplayName("선점 — 첫 INSERT 만 1, 중복은 0. 같은 kind 라도 회차가 다르면 별도 사건(N41)")
    void claimIsFirstComeAndPerEvent() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        UUID groupId = UUID.randomUUID();

        int first = notificationSentLogRepository.insertPendingClaim(UUID.randomUUID(), userId,
                NotificationSentLog.TYPE_BET_RESULT, sessionId, groupId, NOW, NOW);
        int duplicate = notificationSentLogRepository.insertPendingClaim(UUID.randomUUID(), userId,
                NotificationSentLog.TYPE_BET_RESULT, sessionId, groupId, NOW, NOW);
        int otherEvent = notificationSentLogRepository.insertPendingClaim(UUID.randomUUID(), userId,
                NotificationSentLog.TYPE_BET_RESULT, UUID.randomUUID(), groupId, NOW, NOW);

        assertThat(first).isEqualTo(1);
        assertThat(duplicate).isZero();
        assertThat(otherEvent).isEqualTo(1);
    }

    @Test
    @DisplayName("리스 — 만료된 PENDING 만 재클레임되고, 살아 있는 리스·SENT 는 못 뺏는다")
    void reclaimTakesOnlyExpiredPending() {
        UUID userId = UUID.randomUUID();
        UUID expiredSession = UUID.randomUUID();
        UUID freshSession = UUID.randomUUID();
        UUID sentSession = UUID.randomUUID();
        UUID groupId = UUID.randomUUID();

        // 리스 만료(11분 전 선점) — 죽은 워커의 건.
        UUID expiredRowId = UUID.randomUUID();
        notificationSentLogRepository.insertPendingClaim(expiredRowId, userId,
                NotificationSentLog.TYPE_BET_RESULT, expiredSession, groupId, NOW,
                NOW.minus(Duration.ofMinutes(11)));
        // 살아 있는 리스(5분 전 선점).
        notificationSentLogRepository.insertPendingClaim(UUID.randomUUID(), userId,
                NotificationSentLog.TYPE_BET_RESULT, freshSession, groupId, NOW,
                NOW.minus(Duration.ofMinutes(5)));
        // 이미 발송 종결.
        UUID sentRowId = UUID.randomUUID();
        notificationSentLogRepository.insertPendingClaim(sentRowId, userId,
                NotificationSentLog.TYPE_BET_RESULT, sentSession, groupId, NOW,
                NOW.minus(Duration.ofMinutes(30)));
        notificationSentLogRepository.updateStatusByIds(
                List.of(sentRowId), NotificationSendStatus.SENT, NOW);

        Instant cutoff = NOW.minus(LEASE);
        assertThat(notificationSentLogRepository.reclaimExpired(
                userId, NotificationSentLog.TYPE_BET_RESULT, expiredSession, cutoff, NOW)).isEqualTo(1);
        assertThat(notificationSentLogRepository.reclaimExpired(
                userId, NotificationSentLog.TYPE_BET_RESULT, freshSession, cutoff, NOW)).isZero();
        assertThat(notificationSentLogRepository.reclaimExpired(
                userId, NotificationSentLog.TYPE_BET_RESULT, sentSession, cutoff, NOW)).isZero();

        // 재클레임된 행은 리스가 갱신돼 곧바로는 다시 뺏기지 않는다.
        assertThat(notificationSentLogRepository.reclaimExpired(
                userId, NotificationSentLog.TYPE_BET_RESULT, expiredSession, cutoff, NOW)).isZero();
        assertThat(notificationSentLogRepository
                .findByUserIdAndKindAndSubjectId(userId, NotificationSentLog.TYPE_BET_RESULT, expiredSession))
                .hasValueSatisfying(row -> {
                    assertThat(row.getId()).isEqualTo(expiredRowId);
                    assertThat(row.getStatus()).isEqualTo(NotificationSendStatus.PENDING);
                    assertThat(row.getClaimedAt()).isEqualTo(NOW);
                });
    }
}
