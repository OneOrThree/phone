package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.repository.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.support.LeagueWeek;
import com.oneorthree.phone.notification.migration.NotificationCronReplayService;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

/** 실제 재생 진입점 → RR 판정 프록시 → outbox 원자 커밋을 PostgreSQL 충돌로 검증한다. */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
class NotificationBatchRetryIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired NotificationCronReplayService replay;
    @Autowired LeagueWeek leagueWeek;
    @Autowired UserRepository users;
    @Autowired LeagueWeeklyResultRepository results;
    @MockitoSpyBean NotificationDispatcher dispatcher;
    @Autowired OutboxCommandPort outbox;
    @Autowired EventOutboxRepository events;
    @Autowired PlatformTransactionManager transactions;
    @Autowired JdbcTemplate jdbc;

    @Test
    void realRepeatableReadConflictRollsBackWholeBatchAndRetriesOriginalSlot() {
        Instant slot = Instant.now().minusSeconds(60);
        TransactionTemplate tx = new TransactionTemplate(transactions);
        List<UUID> userIds = tx.execute(status -> {
            List<UUID> ids = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                User user = users.save(User.builder().build());
                ids.add(user.getId());
                results.save(LeagueWeeklyResult.builder().user(user)
                        .weekStartAt(leagueWeek.previousWeekStart(slot))
                        .previousTierLevel(1).newTierLevel(1).result(LeagueWeeklyResultType.STAY).build());
                outbox.allocateVersion(AggregateRef.ofUser(user.getId()));
            }
            return ids;
        });
        TransactionTemplate concurrent = new TransactionTemplate(transactions);
        concurrent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        AtomicInteger dispatchCount = new AtomicInteger();
        List<Long> transactionIds = new ArrayList<>();
        doAnswer(invocation -> {
            assertThat(jdbc.queryForObject("SHOW transaction_isolation", String.class))
                    .isEqualTo("repeatable read");
            transactionIds.add(jdbc.queryForObject("SELECT txid_current()", Long.class));
            if (dispatchCount.incrementAndGet() == 2) {
                // 첫 수신자의 실제 outbox 쓰기 뒤, 두 번째 수신자 축을 다른 TX에서 커밋한다.
                // 같은 RR 스냅샷의 두 번째 append에서 실제 40001이 발생한다.
                NotificationRequest request = invocation.getArgument(2);
                concurrent.executeWithoutResult(status ->
                        outbox.allocateVersion(AggregateRef.ofUser(request.userId())));
            }
            return invocation.callRealMethod();
        }).when(dispatcher).dispatch(any(), any(), any(), any(), any());

        var outcome = replay.replay("notification-league-weekly-results", slot);

        assertThat(outcome.outcome()).isEqualTo(NotificationCronReplayService.Outcome.REPLAYED);
        assertThat(transactionIds).hasSize(4);
        assertThat(transactionIds.get(0)).isEqualTo(transactionIds.get(1));
        assertThat(transactionIds.get(2)).isEqualTo(transactionIds.get(3)).isNotEqualTo(transactionIds.get(0));
        var written = events.findAll().stream().filter(row -> userIds.contains(row.getUserId())).toList();
        assertThat(written).hasSize(2);
        assertThat(written).allSatisfy(row -> {
            assertThat(row.getType()).isEqualTo("notification.requested");
            assertThat(row.getEventId()).isEqualTo(NotificationEventKey.of(
                    NotificationKind.LEAGUE_WEEKLY_RESULT, row.getUserId(), null, slot));
        });
        assertThat(written.stream().map(row -> row.getVersion()).sorted().toList()).containsExactly(3L, 4L);
    }
}
