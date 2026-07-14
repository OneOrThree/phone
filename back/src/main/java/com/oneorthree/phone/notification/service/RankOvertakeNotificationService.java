package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotRepository;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
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
@Transactional
public class RankOvertakeNotificationService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Duration DEADLINE_SUPPRESS_WINDOW = Duration.ofHours(12);
    private static final Duration RIVAL_COOLDOWN = Duration.ofHours(48);
    private static final int WEEKLY_CAP = 2;
    private static final int GLOBAL_POPULATION_LIMIT = Integer.MAX_VALUE;

    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final LeagueRankSnapshotRepository leagueRankSnapshotRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final UserRepository userRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;
    private final LeagueWeek leagueWeek;

    /** 스케줄러(매일 19:00 KST)·수동 트리거 진입점. */
    public void sendRankOvertakeNotifications() {
        sendRankOvertakeNotifications(Instant.now());
    }

    /** 전역 순위 추월 푸시 본체. */
    public void sendRankOvertakeNotifications(Instant now) {
        LocalDate today = leagueWeek.currentDate(now);
        LocalDate yesterday = today.minusDays(1);
        LocalDate weekStartDate = leagueWeek.currentWeekStartDate(now);
        List<LeagueRankingRow> ranking = leagueRankingQueryRepository.findTop(
                weekStartDate, today, null, GLOBAL_POPULATION_LIMIT);
        if (ranking.isEmpty()) {
            log.info("순위 추월 푸시 — 전역 랭킹 대상 없음 (today={})", today);
            return;
        }

        List<UUID> userIds = ranking.stream().map(LeagueRankingRow::userId).toList();
        Map<UUID, User> usersById = loadUsers(userIds);
        Map<UUID, Integer> yesterdayRanks = leagueRankSnapshotRepository.findByCreatedAt(yesterday).stream()
                .collect(Collectors.toMap(LeagueRankSnapshot::getUserId, LeagueRankSnapshot::getRank));

        Instant startOfTodayKst = today.atStartOfDay(KST).toInstant();
        Instant startOfTomorrowKst = today.plusDays(1).atStartOfDay(KST).toInstant();
        Set<UUID> focusedTodayUserIds = new HashSet<>(focusSessionRepository
                .findUserIdsWithSessionStartedBetween(userIds, startOfTodayKst, startOfTomorrowKst));
        boolean deadlineImminent = isDeadlineImminent(now);
        Instant weekStart = leagueWeek.currentWeekStart(now);
        Instant sinceForLogs = weekStart.isBefore(now.minus(RIVAL_COOLDOWN))
                ? weekStart : now.minus(RIVAL_COOLDOWN);
        List<NotificationSentLog> logs = notificationSentLogRepository.findByTypeAndUserIdInSince(
                NotificationSentLog.TYPE_RANK_OVERTAKE, userIds, sinceForLogs);

        Map<UUID, Integer> weeklySentCount = new HashMap<>();
        Map<RivalKey, Instant> lastSentToRival = new HashMap<>();
        for (NotificationSentLog logEntry : logs) {
            if (!logEntry.getSentAt().isBefore(weekStart)) {
                weeklySentCount.merge(logEntry.getUserId(), 1, Integer::sum);
            }
            if (logEntry.getTargetUserId() != null) {
                lastSentToRival.merge(
                        new RivalKey(logEntry.getUserId(), logEntry.getTargetUserId()),
                        logEntry.getSentAt(),
                        (first, second) -> first.isAfter(second) ? first : second);
            }
        }

        List<Overtake> overtakes = findOvertakes(
                ranking,
                yesterdayRanks,
                usersById,
                focusedTodayUserIds,
                deadlineImminent,
                weeklySentCount,
                lastSentToRival,
                startOfTodayKst,
                now);
        sendOvertakeNotifications(overtakes, now, today);
        saveTodaySnapshots(ranking, today);
    }

    private List<Overtake> findOvertakes(
            List<LeagueRankingRow> ranking,
            Map<UUID, Integer> yesterdayRanks,
            Map<UUID, User> usersById,
            Set<UUID> focusedTodayUserIds,
            boolean deadlineImminent,
            Map<UUID, Integer> weeklySentCount,
            Map<RivalKey, Instant> lastSentToRival,
            Instant startOfTodayKst,
            Instant now) {
        int maximumRank = Math.max(
                ranking.size(),
                yesterdayRanks.values().stream().mapToInt(Integer::intValue).max().orElse(0));
        FenwickTree previousRowsByYesterdayRank = new FenwickTree(maximumRank);
        int[] prefixMaximumYesterdayRank = new int[ranking.size()];
        List<Overtake> overtakes = new ArrayList<>();

        for (int index = 0; index < ranking.size(); index++) {
            LeagueRankingRow row = ranking.get(index);
            Integer myYesterdayRank = yesterdayRanks.get(row.userId());
            boolean hasValidYesterdayRank = myYesterdayRank != null && myYesterdayRank > 0;
            if (hasValidYesterdayRank && index + 1 < ranking.size()) {
                int rivalCount = previousRowsByYesterdayRank.countAtOrAbove(myYesterdayRank);
                if (rivalCount > 0) {
                    int representativeIndex = findFirstAtOrAbove(
                            prefixMaximumYesterdayRank, index, myYesterdayRank);
                    addIfAllowed(
                            overtakes,
                            row,
                            ranking.get(representativeIndex),
                            rivalCount,
                            usersById,
                            focusedTodayUserIds,
                            deadlineImminent,
                            weeklySentCount,
                            lastSentToRival,
                            startOfTodayKst,
                            now);
                }
            }

            int previousMaximum = index == 0 ? 0 : prefixMaximumYesterdayRank[index - 1];
            prefixMaximumYesterdayRank[index] = !hasValidYesterdayRank
                    ? previousMaximum : Math.max(previousMaximum, myYesterdayRank);
            if (hasValidYesterdayRank) {
                previousRowsByYesterdayRank.add(myYesterdayRank);
            }
        }
        return overtakes;
    }

    private void addIfAllowed(
            List<Overtake> overtakes,
            LeagueRankingRow meRow,
            LeagueRankingRow representativeRow,
            int rivalCount,
            Map<UUID, User> usersById,
            Set<UUID> focusedTodayUserIds,
            boolean deadlineImminent,
            Map<UUID, Integer> weeklySentCount,
            Map<RivalKey, Instant> lastSentToRival,
            Instant startOfTodayKst,
            Instant now) {
        User me = usersById.get(meRow.userId());
        User representative = usersById.get(representativeRow.userId());
        if (me == null || representative == null) {
            return;
        }
        if (me.getLastActiveAt() != null && !me.getLastActiveAt().isBefore(startOfTodayKst)) {
            return;
        }
        if (focusedTodayUserIds.contains(me.getId()) || deadlineImminent) {
            return;
        }
        Instant lastToRival = lastSentToRival.get(new RivalKey(me.getId(), representative.getId()));
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
                    overtake.representative().getNickname(), overtake.rivalCount(), soundEnabled);
            if (pushNotificationService.sendIfAllowed(user, settings, message, now)) {
                newLogs.add(NotificationSentLog.builder()
                        .userId(user.getId())
                        .type(NotificationSentLog.TYPE_RANK_OVERTAKE)
                        .targetUserId(overtake.representative().getId())
                        .sentAt(now)
                        .build());
            }
        }
        notificationSentLogRepository.saveAll(newLogs);
        log.info("순위 추월 푸시 — 대상 {}건 중 실발송 {}건 (today={})",
                overtakes.size(), newLogs.size(), today);
    }

    private void saveTodaySnapshots(List<LeagueRankingRow> ranking, LocalDate today) {
        Map<UUID, LeagueRankSnapshot> existingByUserId = leagueRankSnapshotRepository.findByCreatedAt(today).stream()
                .collect(Collectors.toMap(LeagueRankSnapshot::getUserId, Function.identity()));
        List<LeagueRankSnapshot> newSnapshots = new ArrayList<>();
        for (int index = 0; index < ranking.size(); index++) {
            UUID userId = ranking.get(index).userId();
            int rank = index + 1;
            LeagueRankSnapshot existing = existingByUserId.get(userId);
            if (existing == null) {
                newSnapshots.add(LeagueRankSnapshot.builder()
                        .userId(userId)
                        .rank(rank)
                        .createdAt(today)
                        .build());
            } else {
                existing.setRank(rank);
            }
        }
        leagueRankSnapshotRepository.saveAll(newSnapshots);
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

    private int findFirstAtOrAbove(int[] prefixMaximum, int endExclusive, int threshold) {
        int low = 0;
        int high = endExclusive - 1;
        while (low < high) {
            int middle = (low + high) >>> 1;
            if (prefixMaximum[middle] >= threshold) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        return low;
    }

    private PushMessage compose(String rivalNickname, int rivalCount, boolean soundEnabled) {
        String title = rivalCount > 1
                ? rivalNickname + "님 외 " + (rivalCount - 1) + "명한테 순위 뺏겼어요!"
                : rivalNickname + "님한테 순위 뺏겼어요!";
        return new PushMessage(title, "잠깐 집중해서 다시 제쳐볼까요?", "gromo://league", soundEnabled);
    }

    private record RivalKey(UUID userId, UUID rivalId) {
    }

    private record Overtake(User me, User representative, int rivalCount) {
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
