package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.domain.LeagueRankingRow;
import com.oneorthree.phone.league.support.LeagueWeek;
import com.oneorthree.phone.notification.migration.NotificationCronReplayJob;
import com.oneorthree.phone.notification.migration.NotificationCronReplayService;
import com.oneorthree.phone.outbox.support.PostgresLockWaits;
import com.oneorthree.phone.outbox.support.RawUserLock;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.EntityManager;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * 조각 부분 커밋 뒤의 재판정 사고를 실물 PostgreSQL 에서 세우는 시나리오 (GROMO-893 재리뷰 ①).
 *
 * <ol>
 *   <li>티어 2 사용자 250명을 강등 임계(V13: 50400초) 바로 아래로 둔다 — 일요일 위기 알림이 강등 경고를 판정한다.</li>
 *   <li>재생 진입점으로 배치를 돌리면 첫 페이지 조각이 강등 경고를 커밋한다.</li>
 *   <li>뒤 페이지 조각이 기다리기 시작하면 첫 페이지 사용자의 집중 시간을 강등권 밖·승급 전(60000초)으로 올린다 —
 *       새 스냅샷으로 다시 판정하면 이 사용자는 마감 D-1 이다.</li>
 *   <li>뒤 조각을 반대 순서의 잠금으로 교착 희생자로 만든다.</li>
 * </ol>
 */
final class LeagueCrisisDeadlockScenario {

    static final String JOB = NotificationCronReplayJob.LEAGUE_SUNDAY_CRISIS.lockName();
    private static final int USERS = 250;
    /** 티어 2 강등 임계(50400초) 바로 아래. */
    private static final int BELOW_RELEGATION = 50_399;
    /** 강등권은 벗어났지만 승급 임계(100800초) 전 — 다시 판정하면 마감 D-1 이다. */
    private static final int DEADLINE_D1_TOTAL = 60_000;

    /**
     * @param missedAt  재생할 원래 슬롯
     * @param today     통계를 박은 날
     * @param earlyUser 첫 페이지의 사용자 — 부분 커밋된 강등 경고의 주인
     * @param lateLow   뒤 페이지 조각에서 정본 순서가 앞선 사용자
     * @param lateHigh  같은 조각에서 정본 순서가 뒤인 사용자
     */
    record Seeded(Instant missedAt, LocalDate today, UUID earlyUser, UUID lateLow, UUID lateHigh) {
    }

    private LeagueCrisisDeadlockScenario() {
    }

    static Seeded seed(PlatformTransactionManager transactions, EntityManager em,
                       LeagueRankingQueryRepository ranking, LeagueWeek week) {
        Instant missedAt = Instant.now().minusSeconds(60);
        LocalDate today = week.currentDate(missedAt);
        LocalDate from = week.currentWeekStartDate(missedAt);
        List<UUID> users = new TransactionTemplate(transactions).execute(status -> {
            List<UUID> ids = new ArrayList<>();
            for (int index = 0; index < USERS; index++) {
                User user = User.builder().nickname("위기" + UUID.randomUUID().toString().substring(0, 8))
                        .isGuest(false).language("ko").tierLevel(2).build();
                em.persist(user);
                em.persist(DailyFocusStat.builder().user(user).date(today)
                        .totalFocusSeconds(BELOW_RELEGATION - index).build());
                ids.add(user.getId());
            }
            return ids;
        });
        // 공유 DB 의 다른 사용자가 순위에 끼므로 페이지 위치는 서비스와 같은 커서로 실제로 걸어 본다.
        Set<UUID> mine = new HashSet<>(users);
        int pageSize = LeagueNotificationService.NOTIFICATION_PAGE_SIZE;
        List<List<UUID>> pages = new ArrayList<>();
        Integer cursorSeconds = null;
        UUID cursorUser = null;
        while (true) {
            List<LeagueRankingRow> fetched = ranking.findGlobalRankingPage(from, today, cursorSeconds, cursorUser,
                    pageSize + 1);
            if (fetched.isEmpty()) {
                break;
            }
            boolean hasMore = fetched.size() > pageSize;
            List<LeagueRankingRow> page = hasMore ? fetched.subList(0, pageSize) : fetched;
            pages.add(page.stream().map(LeagueRankingRow::userId).filter(mine::contains).toList());
            if (!hasMore) {
                break;
            }
            LeagueRankingRow last = page.get(page.size() - 1);
            cursorSeconds = last.totalFocusSeconds();
            cursorUser = last.userId();
        }
        List<UUID> late = null;
        for (int index = pages.size() - 1; index > 0; index--) {
            if (pages.get(index).size() >= 2) {
                late = pages.get(index).stream()
                        .sorted((left, right) -> left.toString().compareTo(right.toString())).toList();
                break;
            }
        }
        if (pages.isEmpty() || pages.get(0).isEmpty() || late == null) {
            throw new IllegalStateException("첫 페이지와 뒤 페이지에 걸친 사용자를 세우지 못했다");
        }
        return new Seeded(missedAt, today, pages.get(0).get(0), late.get(0), late.get(late.size() - 1));
    }

    /**
     * 재생을 시작해 뒤 조각을 교착 희생자로 만든다.
     *
     * @return 재생 결과 — 교착이 풀린 뒤에 끝난다
     */
    static Future<NotificationCronReplayService.ReplayResult> replayWithLaterChunkDeadlock(
            ExecutorService pool, JdbcTemplate jdbc, Seeded seeded, NotificationCronReplayService replay)
            throws Exception {
        PostgresLockWaits.ensureUserRows(jdbc, List.of(seeded.lateLow(), seeded.lateHigh()));
        try (RawUserLock reverse = RawUserLock.open()) {
            reverse.lock(seeded.lateHigh());
            Future<NotificationCronReplayService.ReplayResult> replayed =
                    pool.submit(() -> replay.replay(JOB, seeded.missedAt()));
            // 뒤 조각이 이 연결에 막혔다 = 앞 페이지 조각은 이미 커밋됐다.
            PostgresLockWaits.awaitBlockedBy(jdbc, reverse);
            jdbc.update("UPDATE daily_focus_stats SET total_focus_seconds=? WHERE user_id=? AND date=?",
                    DEADLINE_D1_TOTAL, seeded.earlyUser(), seeded.today());
            Future<?> reverseOrder = pool.submit(() -> {
                reverse.lock(seeded.lateLow());
                reverse.commit();
            });
            reverseOrder.get(300, TimeUnit.SECONDS);
            return replayed;
        }
    }

    /** @return 그 사용자에게 적힌 일요일 위기 알림 종류 전부 */
    static List<String> crisisKinds(JdbcTemplate jdbc, UUID user) {
        return jdbc.queryForList("SELECT params->>'kind' FROM event_outbox WHERE user_id=?"
                + " AND params->>'kind' IN ('LEAGUE_RELEGATION_WARNING','LEAGUE_DEADLINE_D1')", String.class, user);
    }
}
