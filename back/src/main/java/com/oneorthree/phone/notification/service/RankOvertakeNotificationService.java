package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotRepository;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotUpsertRepository;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotUpsertRepository.SnapshotRank;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 어제와 오늘의 전역 랭킹을 비교해 순위 추월 푸시를 발송한다. */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(isolation = Isolation.REPEATABLE_READ)
public class RankOvertakeNotificationService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Duration DEADLINE_SUPPRESS_WINDOW = Duration.ofHours(12);
    private static final Duration RIVAL_COOLDOWN = Duration.ofHours(48);
    private static final int WEEKLY_CAP = 2;
    static final int NOTIFICATION_PAGE_SIZE = 200;

    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final LeagueRankSnapshotRepository leagueRankSnapshotRepository;
    private final LeagueRankSnapshotUpsertRepository leagueRankSnapshotUpsertRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final UserRepository userRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;
    private final LeagueWeek leagueWeek;
    private final EntityManager entityManager;

    /** 스케줄러(매일 19:00 KST)·수동 트리거 진입점. */
    public void sendRankOvertakeNotifications() {
        sendRankOvertakeNotifications(Instant.now());
    }

    /** 전역 순위 추월 푸시 본체. */
    public void sendRankOvertakeNotifications(Instant now) {
        LocalDate today = leagueWeek.currentDate(now);
        LocalDate yesterday = today.minusDays(1);
        LocalDate weekStartDate = leagueWeek.currentWeekStartDate(now);
        boolean compareWithYesterday = !today.equals(weekStartDate);
        Instant startOfTodayKst = today.atStartOfDay(KST).toInstant();
        Instant startOfTomorrowKst = today.plusDays(1).atStartOfDay(KST).toInstant();
        boolean deadlineImminent = isDeadlineImminent(now);
        Instant weekStart = leagueWeek.currentWeekStart(now);
        Instant sinceForLogs = weekStart.isBefore(now.minus(RIVAL_COOLDOWN))
                ? weekStart : now.minus(RIVAL_COOLDOWN);
        RankHistoryIndex history = new RankHistoryIndex(compareWithYesterday
                ? leagueRankSnapshotRepository.findMaximumRankByCreatedAt(yesterday) : 0);
        Integer cursorFocusSeconds = null;
        UUID cursorUserId = null;
        int rankOffset = 0;
        while (true) {
            List<LeagueRankingRow> fetched = leagueRankingQueryRepository.findGlobalRankingPage(
                    weekStartDate, today, cursorFocusSeconds, cursorUserId, NOTIFICATION_PAGE_SIZE + 1);
            if (fetched.isEmpty()) {
                break;
            }
            boolean hasMore = fetched.size() > NOTIFICATION_PAGE_SIZE;
            List<LeagueRankingRow> page = hasMore
                    ? fetched.subList(0, NOTIFICATION_PAGE_SIZE) : fetched;
            processRankingPage(
                    page,
                    rankOffset,
                    hasMore,
                    compareWithYesterday,
                    yesterday,
                    today,
                    history,
                    startOfTodayKst,
                    startOfTomorrowKst,
                    deadlineImminent,
                    weekStart,
                    sinceForLogs,
                    now);
            rankOffset += page.size();
            entityManager.flush();
            entityManager.clear();
            if (!hasMore) {
                break;
            }
            LeagueRankingRow lastRow = page.get(page.size() - 1);
            cursorFocusSeconds = lastRow.totalFocusSeconds();
            cursorUserId = lastRow.userId();
        }
        if (rankOffset == 0) {
            log.info("순위 추월 푸시 — 전역 랭킹 대상 없음 (today={})", today);
        }
    }

    private void processRankingPage(
            List<LeagueRankingRow> page,
            int rankOffset,
            boolean hasMore,
            boolean compareWithYesterday,
            LocalDate yesterday,
            LocalDate today,
            RankHistoryIndex history,
            Instant startOfTodayKst,
            Instant startOfTomorrowKst,
            boolean deadlineImminent,
            Instant weekStart,
            Instant sinceForLogs,
            Instant now) {
        List<UUID> userIds = page.stream().map(LeagueRankingRow::userId).toList();
        Map<UUID, User> usersById = loadUsers(userIds);
        Map<UUID, Integer> yesterdayRanks = !compareWithYesterday ? Map.of()
                : leagueRankSnapshotRepository.findByCreatedAtAndUserIdIn(yesterday, userIds).stream()
                        .collect(Collectors.toMap(LeagueRankSnapshot::getUserId, LeagueRankSnapshot::getRank));
        Set<UUID> focusedTodayUserIds = new HashSet<>(focusSessionRepository
                .findUserIdsWithSessionStartedBetween(userIds, startOfTodayKst, startOfTomorrowKst));
        List<NotificationSentLog> logs = notificationSentLogRepository.findByTypeAndUserIdInSince(
                NotificationSentLog.TYPE_RANK_OVERTAKE, userIds, sinceForLogs);
        Map<UUID, Integer> weeklySentCount = weeklySentCount(logs, weekStart);
        Map<RivalKey, Instant> lastSentToRival = lastSentToRival(logs);
        List<Overtake> overtakes = new ArrayList<>();
        List<SnapshotRank> snapshots = new ArrayList<>(page.size());

        for (int index = 0; index < page.size(); index++) {
            LeagueRankingRow row = page.get(index);
            int currentRank = rankOffset + index + 1;
            snapshots.add(new SnapshotRank(row.userId(), currentRank));
            Integer yesterdayRank = yesterdayRanks.get(row.userId());
            if (yesterdayRank != null && yesterdayRank > 0) {
                int rivalCount = history.countAtOrAbove(yesterdayRank);
                boolean isGlobalLastRow = !hasMore && index == page.size() - 1;
                if (rivalCount > 0 && !isGlobalLastRow) {
                    addIfAllowed(
                            overtakes,
                            row,
                            history.firstAtOrAbove(yesterdayRank),
                            rivalCount,
                            usersById,
                            focusedTodayUserIds,
                            deadlineImminent,
                            weeklySentCount,
                            lastSentToRival,
                            startOfTodayKst,
                            now);
                }
                history.add(yesterdayRank, new RivalSummary(
                        row.userId(), row.nickname(), currentRank));
            }
        }
        sendOvertakeNotifications(overtakes, now, today);
        leagueRankSnapshotUpsertRepository.upsertAll(today, snapshots);
    }

    private Map<UUID, Integer> weeklySentCount(List<NotificationSentLog> logs, Instant weekStart) {
        Map<UUID, Integer> counts = new HashMap<>();
        logs.stream()
                .filter(logEntry -> !logEntry.getSentAt().isBefore(weekStart))
                .forEach(logEntry -> counts.merge(logEntry.getUserId(), 1, Integer::sum));
        return counts;
    }

    private Map<RivalKey, Instant> lastSentToRival(List<NotificationSentLog> logs) {
        Map<RivalKey, Instant> lastSent = new HashMap<>();
        logs.stream()
                .filter(logEntry -> logEntry.getTargetUserId() != null)
                .forEach(logEntry -> lastSent.merge(
                        new RivalKey(logEntry.getUserId(), logEntry.getTargetUserId()),
                        logEntry.getSentAt(),
                        (first, second) -> first.isAfter(second) ? first : second));
        return lastSent;
    }

    private void addIfAllowed(
            List<Overtake> overtakes,
            LeagueRankingRow meRow,
            RivalSummary representative,
            int rivalCount,
            Map<UUID, User> usersById,
            Set<UUID> focusedTodayUserIds,
            boolean deadlineImminent,
            Map<UUID, Integer> weeklySentCount,
            Map<RivalKey, Instant> lastSentToRival,
            Instant startOfTodayKst,
            Instant now) {
        User me = usersById.get(meRow.userId());
        if (me == null || representative == null) {
            return;
        }
        if (me.getLastActiveAt() != null && !me.getLastActiveAt().isBefore(startOfTodayKst)) {
            return;
        }
        if (focusedTodayUserIds.contains(me.getId()) || deadlineImminent) {
            return;
        }
        Instant lastToRival = lastSentToRival.get(new RivalKey(me.getId(), representative.userId()));
        if (lastToRival != null && lastToRival.isAfter(now.minus(RIVAL_COOLDOWN))) {
            return;
        }
        if (weeklySentCount.getOrDefault(me.getId(), 0) >= WEEKLY_CAP) {
            return;
        }
        overtakes.add(new Overtake(me, representative, rivalCount));
    }

    private void sendOvertakeNotifications(List<Overtake> overtakes, Instant now, LocalDate today) {
        if (overtakes.isEmpty()) {
            log.info("순위 추월 푸시 — 발송 대상 없음 (today={})", today);
            return;
        }

        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(overtakes.stream()
                .map(overtake -> overtake.me().getId()).toList());
        List<NotificationSentLog> newLogs = new ArrayList<>();
        for (Overtake overtake : overtakes) {
            User user = overtake.me();
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            PushMessage message = compose(
                    overtake.representative().nickname(), overtake.rivalCount(), soundEnabled);
            if (pushNotificationService.sendIfAllowed(user, settings, message, now)) {
                newLogs.add(NotificationSentLog.builder()
                        .userId(user.getId())
                        .type(NotificationSentLog.TYPE_RANK_OVERTAKE)
                        .targetUserId(overtake.representative().userId())
                        .sentAt(now)
                        .build());
            }
        }
        notificationSentLogRepository.saveAll(newLogs);
        log.info("순위 추월 푸시 — 대상 {}건 중 실발송 {}건 (today={})",
                overtakes.size(), newLogs.size(), today);
    }

    private Map<UUID, User> loadUsers(Collection<UUID> userIds) {
        return userRepository.findAllByIdInAndIsDeletedFalse(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
    }

    private Map<UUID, UserNotificationSettings> loadSettings(Collection<UUID> userIds) {
        return userNotificationSettingsRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
    }

    private boolean isDeadlineImminent(Instant now) {
        Instant nextDeadline = leagueWeek.currentWeekStart(now).plus(7, ChronoUnit.DAYS);
        return Duration.between(now, nextDeadline).compareTo(DEADLINE_SUPPRESS_WINDOW) <= 0;
    }

    private PushMessage compose(String rivalNickname, int rivalCount, boolean soundEnabled) {
        String title = rivalCount > 1
                ? rivalNickname + "님 외 " + (rivalCount - 1) + "명한테 순위 뺏겼어요!"
                : rivalNickname + "님한테 순위 뺏겼어요!";
        return new PushMessage(title, "잠깐 집중해서 다시 제쳐볼까요?", "gromo://league", soundEnabled);
    }

    private record RivalKey(UUID userId, UUID rivalId) {
    }

    private record RivalSummary(UUID userId, String nickname, int currentRank) {
    }

    private record Overtake(User me, RivalSummary representative, int rivalCount) {
    }

    /**
     * 지금까지 순회한 오늘 사용자를 어제 순위 기준으로 색인한다.
     * Fenwick tree는 임계 순위 이후의 라이벌 수를, segment tree는 그중 오늘 순위가
     * 가장 앞선 대표 라이벌을 O(log N)으로 찾는다.
     */
    private static final class RankHistoryIndex {

        private final int maximumRank;
        private final FenwickTree counts;
        private final RivalSummary[] earliestTree;

        private RankHistoryIndex(int maximumRank) {
            this.maximumRank = maximumRank;
            this.counts = new FenwickTree(maximumRank);
            this.earliestTree = new RivalSummary[Math.max(1, maximumRank * 4 + 4)];
        }

        private void add(int yesterdayRank, RivalSummary rival) {
            if (yesterdayRank < 1 || yesterdayRank > maximumRank) {
                return;
            }
            counts.add(yesterdayRank);
            update(1, 1, maximumRank, yesterdayRank, rival);
        }

        private int countAtOrAbove(int yesterdayRank) {
            if (yesterdayRank < 1 || yesterdayRank > maximumRank) {
                return 0;
            }
            return counts.countAtOrAbove(yesterdayRank);
        }

        private RivalSummary firstAtOrAbove(int yesterdayRank) {
            if (yesterdayRank < 1 || yesterdayRank > maximumRank) {
                return null;
            }
            return query(1, 1, maximumRank, yesterdayRank, maximumRank);
        }

        private void update(
                int node, int left, int right, int position, RivalSummary rival) {
            if (left == right) {
                earliestTree[node] = earlier(earliestTree[node], rival);
                return;
            }
            int middle = (left + right) >>> 1;
            if (position <= middle) {
                update(node * 2, left, middle, position, rival);
            } else {
                update(node * 2 + 1, middle + 1, right, position, rival);
            }
            earliestTree[node] = earlier(earliestTree[node * 2], earliestTree[node * 2 + 1]);
        }

        private RivalSummary query(
                int node, int left, int right, int queryLeft, int queryRight) {
            if (queryLeft <= left && right <= queryRight) {
                return earliestTree[node];
            }
            int middle = (left + right) >>> 1;
            RivalSummary result = null;
            if (queryLeft <= middle) {
                result = query(node * 2, left, middle, queryLeft, queryRight);
            }
            if (queryRight > middle) {
                result = earlier(
                        result,
                        query(node * 2 + 1, middle + 1, right, queryLeft, queryRight));
            }
            return result;
        }

        private RivalSummary earlier(RivalSummary first, RivalSummary second) {
            if (first == null) {
                return second;
            }
            if (second == null || first.currentRank() < second.currentRank()) {
                return first;
            }
            return second;
        }
    }

    private static final class FenwickTree {

        private final int[] tree;
        private int totalCount;

        private FenwickTree(int size) {
            tree = new int[size + 1];
        }

        private void add(int position) {
            for (int index = position; index < tree.length; index += index & -index) {
                tree[index]++;
            }
            totalCount++;
        }

        private int countAtOrAbove(int position) {
            int belowCount = 0;
            for (int index = position - 1; index > 0; index -= index & -index) {
                belowCount += tree[index];
            }
            return totalCount - belowCount;
        }
    }
}
