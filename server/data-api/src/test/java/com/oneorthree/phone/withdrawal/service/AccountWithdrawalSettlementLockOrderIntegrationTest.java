package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.group.event.GroupBetSessionClosedEvent;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.domain.SettleTrigger;
import com.oneorthree.phone.group.service.GroupBetSettler;
import com.oneorthree.phone.notification.producer.NotificationEventKey;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.outbox.support.PostgresLockWaits;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 계정 탈퇴 × 정산의 잠금 순서 (GROMO-893 · 사례 d) — 실물 PostgreSQL 두 트랜잭션.
 *
 * <p>정산은 회차 행을 잠근 채 커밋 직전에 참가자 USER aggregate 를 잠근다. 탈퇴가 세션 폐기로 USER(탈퇴자)를 먼저 쥐고
 * 내기 해제에서야 회차 행을 기다리면 둘이 서로를 기다린다. 정산을 {@code BEFORE_COMMIT} 직전에 멈춰 회차 행을 쥐게 한 뒤
 * 탈퇴를 시작하고, 탈퇴가 잠금을 기다리기 시작하면 정산을 풀어 교착이 생기는지 본다.
 */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
@Import(AccountWithdrawalSettlementLockOrderIntegrationTest.PauseSettlementBeforeCommit.class)
class AccountWithdrawalSettlementLockOrderIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired GroupBetSettler settler;
    @Autowired AccountWithdrawalService withdrawal;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @PersistenceContext EntityManager em;

    /** 정산 트랜잭션을 커밋 직전(알림 사건을 적기 전)에 세운다 — 회차 행 잠금을 쥔 채다. */
    @TestConfiguration
    static class PauseSettlementBeforeCommit {

        static volatile CountDownLatch paused;
        static volatile CountDownLatch release;

        @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
        @Order(Ordered.HIGHEST_PRECEDENCE)
        public void hold(GroupBetSessionClosedEvent event) throws InterruptedException {
            CountDownLatch gate = release;
            if (gate != null) {
                paused.countDown();
                if (!gate.await(30, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("정산 대기 해제가 오지 않았다");
                }
            }
        }
    }

    @AfterEach
    void disarm() {
        PauseSettlementBeforeCommit.release = null;
    }

    @Test
    @DisplayName("회차를 정산 중인 동안 참가자가 탈퇴해도 교착 없이 정산이 먼저 커밋되고 탈퇴가 뒤이어 끝난다")
    void withdrawalWaitsForTheSettlementInsteadOfDeadlocking() throws Exception {
        record Fixture(UUID session, UUID leaving, UUID staying) {
        }
        Fixture f = new TransactionTemplate(transactions).execute(status -> {
            Group group = Group.builder().name("탈퇴정산").maxMembers(10).build();
            em.persist(group);
            User owner = user();
            User leaving = user();
            User staying = user();
            em.persist(GroupMember.builder().group(group).user(owner).role(GroupMemberRole.OWNER).build());
            em.persist(GroupMember.builder().group(group).user(leaving).role(GroupMemberRole.MEMBER).build());
            em.persist(GroupMember.builder().group(group).user(staying).role(GroupMemberRole.MEMBER).build());
            GroupChallenge challenge = GroupChallenge.builder().group(group).category(MissionCategory.FOCUS)
                    .type(MissionType.DURATION).build();
            em.persist(challenge);
            em.persist(GroupChallengeDuration.builder().challenge(challenge).category(MissionCategory.FOCUS)
                    .durationMinutes(30).build());
            GroupChallengeBet bet = GroupChallengeBet.builder().group(group).challenge(challenge).stake(100)
                    .enabled(true).build();
            em.persist(bet);
            Instant past = Instant.now().minusSeconds(3600);
            GroupChallengeBetSession session = GroupChallengeBetSession.builder().bet(bet).group(group)
                    .challenge(challenge).sessionDate(LocalDate.now(ZoneOffset.UTC).minusDays(1)).stake(100)
                    .goalMinutes(30).missionCategory(MissionCategory.FOCUS).missionType(MissionType.DURATION)
                    .startsAt(past.minusSeconds(3600)).joinClosesAt(past).closesAt(past).settleAfter(past).build();
            em.persist(session);
            em.persist(GroupChallengeBetParticipant.builder().session(session).user(leaving).achieved(true).build());
            em.persist(GroupChallengeBetParticipant.builder().session(session).user(staying).achieved(true).build());
            return new Fixture(session.getId(), leaving.getId(), staying.getId());
        });
        PauseSettlementBeforeCommit.paused = new CountDownLatch(1);
        PauseSettlementBeforeCommit.release = new CountDownLatch(1);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<GroupBetSettler.SettleResult> settling =
                    pool.submit(() -> settler.settle(f.session(), SettleTrigger.MANUAL));
            assertThat(PauseSettlementBeforeCommit.paused.await(30, TimeUnit.SECONDS)).isTrue();
            Future<?> withdrawing = pool.submit(() -> withdrawal.withdraw(f.leaving()));
            PostgresLockWaits.awaitWaiting(jdbc, 1);
            PauseSettlementBeforeCommit.release.countDown();

            assertThat(settling.get(60, TimeUnit.SECONDS).applied()).isTrue();
            withdrawing.get(60, TimeUnit.SECONDS);
        } finally {
            PauseSettlementBeforeCommit.release.countDown();
            pool.shutdownNow();
        }

        assertThat(jdbc.queryForObject("SELECT status FROM group_challenge_bet_sessions WHERE id=?", String.class,
                f.session())).isEqualTo("SETTLED");
        assertThat(jdbc.queryForObject("SELECT is_deleted FROM users WHERE id=?", Boolean.class, f.leaving())).isTrue();
        for (UUID participant : new UUID[] {f.leaving(), f.staying()}) {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM event_outbox WHERE event_id=?", Long.class,
                    NotificationEventKey.of(NotificationKind.BET_RESULT, participant, f.session(), null)))
                    .isEqualTo(1L);
        }
    }

    private User user() {
        User user = User.builder().nickname("탈퇴" + UUID.randomUUID().toString().substring(0, 8)).isGuest(false)
                .language("ko").build();
        em.persist(user);
        em.persist(UserWallet.builder().userId(user.getId()).balance(1000).build());
        return user;
    }
}
