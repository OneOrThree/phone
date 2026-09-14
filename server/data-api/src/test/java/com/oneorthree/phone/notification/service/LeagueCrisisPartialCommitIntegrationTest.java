package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.support.LeagueWeek;
import com.oneorthree.phone.notification.migration.NotificationCronReplayService;
import com.oneorthree.phone.notification.producer.NotificationFanOutPartiallyCommittedException;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * 조각 재시도가 소진돼도 앞 조각이 커밋돼 있으면 재판정하지 않는다 — 원래 슬롯의 재생 좌표를 싣고 멈춘다
 * (GROMO-893 재리뷰 ①).
 *
 * <p>조각 시도 횟수를 1 로 둬 교착 한 번이 곧 소진이 되게 한다. 설정값이지 동작을 바꾸는 목이 아니다.
 */
@SpringBootTest(properties = {"notification.dispatch.mode=OUTBOX", "notification.fanout.chunk-max-attempts=1"})
class LeagueCrisisPartialCommitIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired NotificationCronReplayService replay;
    @Autowired LeagueRankingQueryRepository ranking;
    @Autowired LeagueWeek week;
    @Autowired MeterRegistry meterRegistry;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;
    @PersistenceContext EntityManager em;

    @Test
    @DisplayName("앞 조각이 커밋된 뒤 조각 재시도가 소진되면 재판정하지 않고 원래 슬롯의 재생 좌표를 남긴다")
    void anExhaustedChunkAfterEarlierCommitsSurfacesReplayCoordinatesInsteadOfRejudging() throws Exception {
        LeagueCrisisDeadlockScenario.Seeded seeded = LeagueCrisisDeadlockScenario.seed(transactions, em, ranking, week);
        String job = LeagueCrisisDeadlockScenario.JOB;
        double partials = count(NotificationBatchRetry.PARTIAL_COMMIT_METRIC, "job", job, "sqlState", "40P01");
        double batchRetries = count(NotificationBatchRetry.RETRY_METRIC, "job", job, "sqlState", "40P01");

        ExecutorService pool = Executors.newFixedThreadPool(2);
        ExecutionException failed;
        try {
            Future<NotificationCronReplayService.ReplayResult> replayed =
                    LeagueCrisisDeadlockScenario.replayWithLaterChunkDeadlock(pool, jdbc, seeded, replay);
            failed = catchThrowableOfType(ExecutionException.class, () -> replayed.get(300, TimeUnit.SECONDS));
        } finally {
            // 인터럽트는 JDBC 대기를 끊지 못한다 — 끝나지 않은 재생이 다음 테스트의 잠금 관측에 섞이지 않게 끝까지 기다린다.
            pool.shutdown();
            if (!pool.awaitTermination(300, TimeUnit.SECONDS)) {
                pool.shutdownNow();
            }
        }

        assertThat(failed).isNotNull();
        assertThat(failed.getCause()).isInstanceOfSatisfying(NotificationFanOutPartiallyCommittedException.class,
                partial -> {
                    assertThat(partial.getReplayJob()).isEqualTo(job);
                    assertThat(partial.getReplaySlot()).isEqualTo(seeded.missedAt());
                    assertThat(partial.getSqlState()).isEqualTo("40P01");
                    assertThat(partial.getCommittedChunks()).isPositive();
                    assertThat(partial.getMessage()).contains("replay(\"" + job + "\", Instant.parse(\""
                            + seeded.missedAt() + "\"))");
                });
        assertThat(LeagueCrisisDeadlockScenario.crisisKinds(jdbc, seeded.earlyUser()))
                .as("커밋된 강등 경고만 남는다 — 재판정했다면 마감 D-1 이 한 건 더 있다")
                .containsExactly("LEAGUE_RELEGATION_WARNING");
        assertThat(count(NotificationBatchRetry.PARTIAL_COMMIT_METRIC, "job", job, "sqlState", "40P01"))
                .isEqualTo(partials + 1);
        assertThat(count(NotificationBatchRetry.RETRY_METRIC, "job", job, "sqlState", "40P01")).isEqualTo(batchRetries);
    }

    private double count(String name, String... tags) {
        Counter counter = meterRegistry.find(name).tags(tags).counter();
        return counter == null ? 0 : counter.count();
    }
}
