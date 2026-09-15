package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.domain.UserStreak;
import com.oneorthree.phone.notification.migration.NotificationCronReplayJob;
import com.oneorthree.phone.notification.migration.NotificationCronReplayService;
import com.oneorthree.phone.notification.producer.NotificationEventKey;
import com.oneorthree.phone.notification.producer.NotificationFanOutWriter;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.outbox.support.PostgresLockWaits;
import com.oneorthree.phone.outbox.support.RawUserLock;
import com.oneorthree.phone.user.repository.domain.User;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 전역 사용자를 여러 페이지로 훑는 리그·재참여 배치가 USER 잠금을 <b>페이지 경계에서 놓는지</b> — 실물 PostgreSQL
 * 트랜잭션으로 본다 (GROMO-893 ① ③ ④ ⑤).
 *
 * <p>페이지 크기가 200 이라 사용자 250 명이 두 페이지에 걸친다. 판정은 한 RR 스냅샷에서 끝나고(순위가 페이지 사이에
 * 흔들리지 않는다), 적기는 페이지마다 짧은 트랜잭션이다.
 */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class LeagueFanOutPageBoundaryIntegrationTest {

    /** 배치는 전역 순위의 사용자 전부를 판정·기록한다 — 이 클래스가 심은 사용자만 두려고 DB 를 따로 쓴다. */
    private static final PostgreSQLContainer<?> POSTGRES =
            OutboxTestPostgres.startDedicated("league_fanout_page_boundary");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry, POSTGRES);
    }

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    /** 수요일 12:00 KST. 주 시작(월)과 어제(화)에 통계·스트릭을 박는다. */
    private static final Instant NOW = Instant.parse("2027-03-03T03:00:00Z");
    private static final LocalDate MONDAY = LocalDate.of(2027, 3, 1);
    private static final LocalDate TUESDAY = LocalDate.of(2027, 3, 2);
    private static final int USERS = 250;
    private static final List<UUID> RANKED = new ArrayList<>();

    @Autowired LeagueNotificationService league;
    @Autowired LeagueReengagementNotificationService reengagement;
    @Autowired NotificationCronReplayService replay;
    @Autowired MeterRegistry meterRegistry;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @PersistenceContext EntityManager em;

    @BeforeEach
    void seedOnce() {
        synchronized (RANKED) {
            if (!RANKED.isEmpty()) {
                return;
            }
            RANKED.addAll(new TransactionTemplate(transactions).execute(status -> {
                List<UUID> ids = new ArrayList<>();
                for (int index = 0; index < USERS; index++) {
                    User user = User.builder().nickname("리그" + UUID.randomUUID().toString().substring(0, 8))
                            .isGuest(false).language("ko").build();
                    em.persist(user);
                    // 순위 = 생성 순서. 공유 DB 의 다른 사용자보다 확실히 앞선다.
                    em.persist(DailyFocusStat.builder().user(user).date(MONDAY)
                            .totalFocusSeconds(10_000_000 - index).build());
                    em.persist(UserStreak.builder().user(user).streakCount(5).lastSessionDate(TUESDAY).build());
                    ids.add(user.getId());
                }
                return ids;
            }));
        }
    }

    private long events(NotificationKind kind, List<UUID> users) {
        Long count = jdbc.queryForObject("SELECT count(*) FROM event_outbox WHERE type='notification.requested'"
                + " AND params->>'kind'=? AND user_id::text = ANY(?)", Long.class, kind.name(),
                users.stream().map(UUID::toString).toArray(String[]::new));
        return count == null ? 0 : count;
    }

    /**
     * 두 번째 페이지의 사용자를 쥔 다른 트랜잭션이 첫 페이지의 사용자를 요청한다 — 수신자 순서가 반대인 트랜잭션이다.
     *
     * <p>배치가 모든 페이지를 한 트랜잭션에서 적으면 첫 페이지 잠금을 쥔 채 두 번째 페이지에서 기다리므로 순환이
     * 생겨 PostgreSQL 이 먼저 기다린 배치를 {@code 40P01} 로 끊는다. 페이지마다 커밋하면 첫 페이지 잠금은 이미
     * 풀려 반대 순서의 트랜잭션이 곧바로 지나가고, 배치는 기다렸다가 끝난다.
     */
    @Test
    @DisplayName("리그 마감 배치는 페이지마다 잠금을 놓아, 페이지 경계를 거꾸로 잡는 트랜잭션과 교착하지 않는다")
    void deadlineBatchReleasesEachPageBeforeTheNext() throws Exception {
        UUID pageOne = RANKED.get(0);
        UUID pageTwo = RANKED.get(220);
        PostgresLockWaits.ensureUserRows(jdbc, List.of(pageOne, pageTwo));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (RawUserLock reverse = RawUserLock.open(POSTGRES)) {
            reverse.lock(pageTwo);
            Future<?> batch = pool.submit(() -> league.sendDeadlineReminders(NOW));
            PostgresLockWaits.awaitBlockedBy(jdbc, reverse);
            Future<?> reverseOrder = pool.submit(() -> {
                reverse.lock(pageOne);
                reverse.commit();
            });
            reverseOrder.get(300, TimeUnit.SECONDS);
            batch.get(300, TimeUnit.SECONDS);
        } finally {
            drain(pool);
        }
        assertThat(events(NotificationKind.LEAGUE_DEADLINE, RANKED)).isEqualTo(USERS);
        // 판정은 한 스냅샷이다 — 페이지를 나눠 적어도 순위가 끊기거나 겹치지 않는다.
        List<Integer> ranks = RANKED.stream().map(user -> jdbc.queryForObject("SELECT (params->>'rank')::int"
                + " FROM event_outbox WHERE event_id=?", Integer.class,
                NotificationEventKey.of(NotificationKind.LEAGUE_DEADLINE, user, null, NOW))).toList();
        assertThat(ranks).containsExactlyElementsOf(IntStream.rangeClosed(1, USERS).boxed().toList());
    }

    @Test
    @DisplayName("순위순·사용자순으로 같은 사용자를 여러 페이지 훑는 배치 셋이 동시에 돌아도 전부 끝난다")
    void rankAndUserOrderedBatchesOverTheSameUsersCompleteConcurrently() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(3);
        try {
            List<Future<?>> batches = List.of(
                    pool.submit(() -> league.sendFinalDeadlineReminders(NOW)),
                    pool.submit(() -> reengagement.sendStreakAtRisk(NOW)),
                    pool.submit(() -> reengagement.sendMissedFocusToday(NOW)));
            for (Future<?> future : batches) {
                future.get(300, TimeUnit.SECONDS);
            }
        } finally {
            drain(pool);
        }
        assertThat(events(NotificationKind.LEAGUE_FINAL_DEADLINE, RANKED)).isEqualTo(USERS);
        assertThat(events(NotificationKind.STREAK_AT_RISK, RANKED)).isEqualTo(USERS);
        assertThat(events(NotificationKind.MISSED_FOCUS_TODAY, RANKED)).isEqualTo(USERS);
    }

    /**
     * 조각 트랜잭션이 교착 희생자가 되면 그 조각만 <b>같은 요청</b>으로 새 트랜잭션에서 다시 적는다 — 재판정하지 않는다.
     *
     * <p>재생 진입점은 실제 시계로 유효기간을 보므로 이 사용자들은 «오늘»의 통계를 갖는다. 다른 트랜잭션이 가장 뒤
     * 사용자를 쥔 채, 조각이 앞 사용자를 쥐고 기다리기 시작하면 앞 사용자를 요청해 순환을 만든다. 먼저 기다린 조각이
     * {@code 40P01} 로 끊기고, 다시 돈 배치는 결정적 키 덕분에 사용자마다 사건을 정확히 한 건 남긴다.
     */
    @Test
    @DisplayName("교착 희생자가 된 조각은 같은 요청으로 새 트랜잭션에서 다시 적히고 사건은 중복되지 않는다")
    void aDeadlockVictimChunkIsRetriedInANewTransactionWithoutDuplicates() throws Exception {
        Instant missedAt = Instant.now().minusSeconds(60);
        LocalDate today = LocalDate.ofInstant(missedAt, KST);
        List<UUID> users = new TransactionTemplate(transactions).execute(status -> {
            List<UUID> ids = new ArrayList<>();
            for (int index = 0; index < 3; index++) {
                User user = User.builder().nickname("재시도" + UUID.randomUUID().toString().substring(0, 8))
                        .isGuest(false).language("ko").build();
                em.persist(user);
                em.persist(DailyFocusStat.builder().user(user).date(today).totalFocusSeconds(90_000_000 - index)
                        .build());
                ids.add(user.getId());
            }
            return ids;
        });
        List<UUID> canonical = users.stream().sorted((left, right) -> left.toString().compareTo(right.toString()))
                .toList();
        UUID low = canonical.get(0);
        UUID high = canonical.get(2);
        PostgresLockWaits.ensureUserRows(jdbc, users);
        String job = NotificationCronReplayJob.MISSED_FOCUS_TODAY.lockName();
        double retriesBefore = retries(job);
        double chunkRetriesBefore = chunkRetries();

        ExecutorService pool = Executors.newFixedThreadPool(2);
        NotificationCronReplayService.ReplayResult result;
        try (RawUserLock reverse = RawUserLock.open(POSTGRES)) {
            reverse.lock(high);
            Future<NotificationCronReplayService.ReplayResult> replayed =
                    pool.submit(() -> replay.replay(job, missedAt));
            PostgresLockWaits.awaitBlockedBy(jdbc, reverse);
            Future<?> reverseOrder = pool.submit(() -> {
                reverse.lock(low);
                reverse.commit();
            });
            reverseOrder.get(300, TimeUnit.SECONDS);
            result = replayed.get(300, TimeUnit.SECONDS);
        } finally {
            drain(pool);
        }

        assertThat(result.outcome()).isEqualTo(NotificationCronReplayService.Outcome.REPLAYED);
        assertThat(chunkRetries()).isEqualTo(chunkRetriesBefore + 1);
        assertThat(retries(job)).as("배치 재판정은 돌지 않는다").isEqualTo(retriesBefore);
        assertThat(meterRegistry.find(NotificationBatchRetry.EXHAUSTED_METRIC).tag("job", job).counter()).isNull();
        for (UUID user : users) {
            assertThat(jdbc.queryForList("SELECT event_id FROM event_outbox WHERE user_id=?"
                    + " AND params->>'kind'='MISSED_FOCUS_TODAY'", String.class, user))
                    .containsExactly(NotificationEventKey.of(NotificationKind.MISSED_FOCUS_TODAY, user, null, missedAt));
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM event_outbox WHERE user_id::text = ANY(?)", Long.class,
                (Object) users.stream().map(UUID::toString).toArray(String[]::new))).isEqualTo(3L);
    }

    /**
     * 풀의 작업이 끝날 때까지 기다린다 — 인터럽트는 JDBC 대기·쿼리를 끊지 못해서, 시한을 넘긴 배치가 살아남아 다음
     * 테스트의 잠금 관측과 연결 풀에 섞인다.
     */
    private static void drain(ExecutorService pool) throws InterruptedException {
        pool.shutdown();
        if (!pool.awaitTermination(300, TimeUnit.SECONDS)) {
            pool.shutdownNow();
        }
    }

    private double chunkRetries() {
        Counter counter = meterRegistry.find(NotificationFanOutWriter.CHUNK_RETRY_METRIC)
                .tags("sqlState", "40P01").counter();
        return counter == null ? 0 : counter.count();
    }

    private double retries(String job) {
        Counter counter = meterRegistry.find(NotificationBatchRetry.RETRY_METRIC)
                .tags("job", job, "sqlState", "40P01").counter();
        return counter == null ? 0 : counter.count();
    }
}
