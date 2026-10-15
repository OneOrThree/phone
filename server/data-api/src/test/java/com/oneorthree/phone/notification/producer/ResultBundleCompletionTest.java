package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import com.oneorthree.phone.group.repository.domain.SettleTrigger;
import com.oneorthree.phone.group.service.GroupBetSettler;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실물 PG의 두 트랜잭션으로 슬롯 마감과 늦은 정산 커밋의 순서를 검증한다. */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
class ResultBundleCompletionTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired ResultBundleCompletionService bundles;
    @Autowired NotificationOutboxProducer producer;
    @Autowired EventOutboxRepository outbox;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager manager;
    @Autowired GroupBetSettler settler;
    @PersistenceContext EntityManager em;

    private TransactionTemplate tx() {
        return new TransactionTemplate(manager);
    }

    private NotificationRequest request(UUID user, UUID group, UUID session, Instant slot) {
        return new NotificationRequest(NotificationKind.BET_RESULT, user, session, group, slot, null, "ko",
                Map.of("betStatus", "SETTLED", "achieved", true, "payout", 100, "stake", 100));
    }

    @Test
    void sealWaitsForTheUncommittedProducerAndIncludesItsEvent() throws Exception {
        concurrentSeal(false);
    }

    @Test
    void rolledBackSettlementDoesNotLeaveAnExpectedEvent() throws Exception {
        concurrentSeal(true);
    }

    private void concurrentSeal(boolean rollback) throws Exception {
        UUID group = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        Instant slot = ResultBundleCompletionService.slotOf(Instant.now()).minusSeconds(900);
        NotificationRequest first = request(user, group, UUID.randomUUID(), slot);
        NotificationRequest late = request(user, group, UUID.randomUUID(), slot);
        String firstId = tx().execute(ignored -> producer.append(first).orElseThrow().eventId());
        String lateId = producer.eventIdOf(late);
        CountDownLatch registered = new CountDownLatch(1);
        CountDownLatch finish = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var writing = pool.submit(() -> tx().executeWithoutResult(status -> {
                producer.append(late);
                registered.countDown();
                await(finish);
                if (rollback) {
                    status.setRollbackOnly();
                }
            }));
            assertThat(registered.await(10, TimeUnit.SECONDS)).isTrue();
            var sealing = pool.submit(() -> tx().executeWithoutResult(ignored -> bundles.seal(group, slot)));
            assertThatThrownBy(() -> sealing.get(200, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
            assertThat(jdbc.queryForList("SELECT * FROM notification_result_bundle_manifests WHERE group_id=?",
                    group)).isEmpty();
            finish.countDown();
            writing.get(10, TimeUnit.SECONDS);
            sealing.get(10, TimeUnit.SECONDS);
            List<String> members = jdbc.queryForList("SELECT jsonb_array_elements_text(event_ids)"
                    + " FROM notification_result_bundle_manifests WHERE group_id=?", String.class, group);
            assertThat(members).contains(firstId);
            if (rollback) {
                assertThat(members).doesNotContain(lateId);
                assertThat(outbox.findByEventId(lateId)).isEmpty();
            } else {
                assertThat(members).contains(lateId).hasSize(2);
                assertThat(outbox.findByEventId(lateId)).isPresent();
            }
        } finally {
            finish.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void settlementTimestampIsReadAfterWaitingForTheSlotFence() throws Exception {
        UUID group = UUID.randomUUID();
        Instant slot = ResultBundleCompletionService.slotOf(Instant.now());
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var sealing = pool.submit(() -> tx().executeWithoutResult(ignored -> {
                jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
                        "notification-result-slot:" + group + ":" + slot.getEpochSecond());
                locked.countDown();
                await(release);
            }));
            assertThat(locked.await(10, TimeUnit.SECONDS)).isTrue();
            var settling = pool.submit(() -> tx().execute(ignored -> bundles.settlementTime(group)));
            assertThatThrownBy(() -> settling.get(200, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
            Instant afterWait = jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class).toInstant();
            release.countDown();
            sealing.get(10, TimeUnit.SECONDS);
            assertThat(settling.get(10, TimeUnit.SECONDS)).isAfterOrEqualTo(afterWait);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void sealedManifestSurvivesASeparatePublisherAndCannotBeExpandedByRescan() {
        UUID group = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        Instant slot = ResultBundleCompletionService.slotOf(Instant.now()).minusSeconds(900);
        NotificationRequest request = request(user, group, UUID.randomUUID(), slot);
        String eventId = tx().execute(ignored -> producer.append(request).orElseThrow().eventId());
        tx().executeWithoutResult(ignored -> bundles.seal(group, slot));
        String sealId = "noti:resultBundle:" + user + ":" + group + ":" + slot.getEpochSecond();
        assertThat(outbox.findByEventId(sealId)).isEmpty();
        bundles.flushClosedBundles();
        assertThat(outbox.findByEventId(sealId).orElseThrow().getParams().get("eventIds"))
                .isEqualTo(List.of(eventId));
        long version = outbox.findByEventId(sealId).orElseThrow().getVersion();
        bundles.flushClosedBundles();
        assertThat(outbox.findByEventId(sealId).orElseThrow().getVersion()).isEqualTo(version);
        var replayed = tx().execute(ignored -> producer.append(request));
        assertThat(replayed).isEmpty();
        NotificationRequest unexpected = request(user, group, UUID.randomUUID(), slot);
        assertThatThrownBy(() -> tx().execute(ignored -> producer.append(unexpected)))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("이미 완료된");
    }


    @ParameterizedTest
    @ValueSource(strings = {"SETTLED", "INSUFFICIENT", "DEADLINE", "DELETED"})
    void actualSettlementCommitsEveryRecipientEventBeforeReleasingTheFence(String path) {
        List<UUID> recipients = new ArrayList<>();
        UUID[] ids = tx().execute(ignored -> {
            Group group = Group.builder().name("묶음 정산").build();
            em.persist(group);
            GroupChallenge challenge = GroupChallenge.builder().group(group).category(MissionCategory.FOCUS)
                    .type(MissionType.DURATION).build();
            em.persist(challenge);
            em.persist(GroupChallengeDuration.builder().challenge(challenge).category(MissionCategory.FOCUS)
                    .durationMinutes(30).build());
            GroupChallengeBet bet = GroupChallengeBet.builder().group(group).challenge(challenge)
                    .stake(100).enabled(true).build();
            em.persist(bet);
            Instant past = Instant.now().minusSeconds("DEADLINE".equals(path) ? 90000 : 3600);
            GroupChallengeBetSession session = GroupChallengeBetSession.builder().bet(bet).group(group)
                    .challenge(challenge).sessionDate(LocalDate.now(ZoneOffset.UTC).minusDays(1))
                    .stake(100).goalMinutes(30).missionCategory(MissionCategory.FOCUS)
                    .missionType(MissionType.DURATION).startsAt(past.minusSeconds(3600))
                    .joinClosesAt(past).closesAt(past).settleAfter(past).build();
            em.persist(session);
            for (int index = 0; index < ("INSUFFICIENT".equals(path) ? 1 : 2); index++) {
                User user = User.builder().nickname("수신" + UUID.randomUUID().toString().substring(0, 8))
                        .isGuest(false).build();
                em.persist(user);
                em.persist(UserWallet.builder().userId(user.getId()).balance(1000).build());
                em.persist(GroupChallengeBetParticipant.builder().session(session).user(user)
                        .achieved(true).build());
                recipients.add(user.getId());
            }
            return new UUID[] {session.getId(), group.getId(), challenge.getId()};
        });
        if ("DELETED".equals(path)) {
            settler.voidOpenSessionsForChallengeDelete(ids[2]);
        } else {
            assertThat(settler.settle(ids[0], SettleTrigger.MANUAL).applied()).isTrue();
        }
        // 이 검사는 rescan을 한 번도 실행하지 않는다. BEFORE_COMMIT에서 이미 전부 있어야 한다.
        String kind = "SETTLED".equals(path) ? "BET_RESULT" : "BET_VOID_REFUND";
        for (UUID user : recipients) {
            String event = NotificationEventKey.of(NotificationKind.valueOf(kind), user, ids[0], null);
            assertThat(outbox.findByEventId(event)).as(path + " 참가자 사건").isPresent();
            Map<String, Object> member = jdbc.queryForMap(
                    "SELECT group_id,slot_at FROM notification_result_bundle_members WHERE event_id=?", event);
            assertThat(member.get("group_id")).isEqualTo(ids[1]);
            Instant settledAt = jdbc.queryForObject("SELECT settled_at FROM group_challenge_bet_sessions WHERE id=?",
                    Timestamp.class, ids[0]).toInstant();
            assertThat(((Timestamp) member.get("slot_at")).toInstant())
                    .isEqualTo(ResultBundleCompletionService.slotOf(settledAt));
        }
    }

    @Test
    void importedLegacyHistoryAndFreshEventsShareOneCompleteManifest() {
        UUID group = UUID.randomUUID();
        Instant slot = ResultBundleCompletionService.slotOf(Instant.now()).minusSeconds(1800);
        UUID user = tx().execute(ignored -> {
            User owner = User.builder().nickname("이관" + UUID.randomUUID().toString().substring(0, 8)).build();
            em.persist(owner);
            return owner.getId();
        });
        UUID oldSession = UUID.randomUUID();
        jdbc.update("INSERT INTO notification_sent_logs(id,user_id,type,kind,subject_id,status,group_id,slot_at,sent_at)"
                + " VALUES(?,?,'BET_RESULT','BET_RESULT',?,'SENT',?,?,?)", UUID.randomUUID(), user,
                oldSession, group, Timestamp.from(slot), Timestamp.from(slot.plusSeconds(900)));
        String oldEvent = NotificationEventKey.of(NotificationKind.BET_RESULT, user, oldSession, null);
        NotificationRequest fresh = request(user, group, UUID.randomUUID(), slot);
        String freshEvent = tx().execute(ignored -> producer.append(fresh).orElseThrow().eventId());
        bundles.flushClosedBundles();
        List<String> members = jdbc.queryForList("SELECT jsonb_array_elements_text(event_ids)"
                + " FROM notification_result_bundle_manifests WHERE group_id=?", String.class, group);
        assertThat(members).containsExactlyInAnyOrder(oldEvent, freshEvent);
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("latch timeout");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }
}
