package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.support.LeagueWeek;
import com.oneorthree.phone.notification.migration.NotificationCronReplayService;
import com.oneorthree.phone.notification.producer.NotificationFanOutWriter;
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

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 부분 커밋 뒤 교착이 «재판정»으로 번지지 않는다 — 실패한 조각만 같은 요청으로 다시 적는다 (GROMO-893 재리뷰 ①).
 *
 * <p>시나리오는 {@link LeagueCrisisDeadlockScenario}. 배치 전체를 새 스냅샷으로 다시 판정하면 첫 페이지 사용자는 강등
 * 경고(커밋됨)에 더해 마감 D-1 을 같은 날 한 번 더 받는다.
 */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
class LeagueCrisisChunkRetryIntegrationTest {

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
    @DisplayName("앞 페이지가 강등 경고를 커밋한 뒤 뒤 조각이 교착해도 조각만 다시 적어, 그 사용자의 위기 알림은 한 건이다")
    void aDeadlockedLaterChunkIsRewrittenWithoutRejudgingCommittedPages() throws Exception {
        LeagueCrisisDeadlockScenario.Seeded seeded = LeagueCrisisDeadlockScenario.seed(transactions, em, ranking, week);
        double chunkRetries = count(NotificationFanOutWriter.CHUNK_RETRY_METRIC, "sqlState", "40P01");
        double batchRetries = count(NotificationBatchRetry.RETRY_METRIC, "job", LeagueCrisisDeadlockScenario.JOB,
                "sqlState", "40P01");

        ExecutorService pool = Executors.newFixedThreadPool(2);
        NotificationCronReplayService.ReplayResult result;
        try {
            result = LeagueCrisisDeadlockScenario.replayWithLaterChunkDeadlock(pool, jdbc, seeded, replay)
                    .get(300, TimeUnit.SECONDS);
        } finally {
            // 인터럽트는 JDBC 대기를 끊지 못한다 — 끝나지 않은 재생이 다음 테스트의 잠금 관측에 섞이지 않게 끝까지 기다린다.
            pool.shutdown();
            if (!pool.awaitTermination(300, TimeUnit.SECONDS)) {
                pool.shutdownNow();
            }
        }

        assertThat(result.outcome()).isEqualTo(NotificationCronReplayService.Outcome.REPLAYED);
        assertThat(LeagueCrisisDeadlockScenario.crisisKinds(jdbc, seeded.earlyUser()))
                .as("판정 스냅샷 하나의 결과만 남는다 — 재판정했다면 마감 D-1 이 한 건 더 있다")
                .containsExactly("LEAGUE_RELEGATION_WARNING");
        assertThat(count(NotificationFanOutWriter.CHUNK_RETRY_METRIC, "sqlState", "40P01")).isEqualTo(chunkRetries + 1);
        assertThat(count(NotificationBatchRetry.RETRY_METRIC, "job", LeagueCrisisDeadlockScenario.JOB,
                "sqlState", "40P01")).as("배치 재시도(재판정)는 한 번도 돌지 않는다").isEqualTo(batchRetries);
    }

    private double count(String name, String... tags) {
        Counter counter = meterRegistry.find(name).tags(tags).counter();
        return counter == null ? 0 : counter.count();
    }
}
