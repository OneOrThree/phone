package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.domain.UserStreak;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 리그 재참여 압박 푸시 — 오늘 미집중(평일 21시)·스트릭 위기(밤 22시)를 발송한다 (GROMO-841). */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(isolation = Isolation.REPEATABLE_READ)
public class LeagueReengagementNotificationService {

    static final int NOTIFICATION_PAGE_SIZE = 200;

    /** 스트릭(출석) 인정 최소 집중 초 — 하루 10분(FocusService.STREAK_MIN_SECONDS 와 동일 기준, GROMO-806). */
    private static final int STREAK_MIN_SECONDS = 600;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final UserStreakRepository userStreakRepository;
    private final UserRepository userRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final PushNotificationService pushNotificationService;
    private final LeagueWeek leagueWeek;
    private final EntityManager entityManager;

    /** 오늘 미집중 알림 — 스케줄러(평일 21:00 KST)·수동 트리거 진입점. */
    public void sendMissedFocusToday() {
        sendMissedFocusToday(Instant.now());
    }

    public void sendMissedFocusToday(Instant now) {
        LocalDate fromDate = leagueWeek.currentWeekStartDate(now);
        LocalDate today = leagueWeek.currentDate(now);
        Instant startToday = today.atStartOfDay(KST).toInstant();
        Instant startTomorrow = today.plusDays(1).atStartOfDay(KST).toInstant();
        int processedCount = 0;
        Integer cursorFocusSeconds = null;
        UUID cursorUserId = null;
        while (true) {
            List<LeagueRankingRow> fetched = leagueRankingQueryRepository.findGlobalRankingPage(
                    fromDate, today, cursorFocusSeconds, cursorUserId, NOTIFICATION_PAGE_SIZE + 1);
            if (fetched.isEmpty()) {
                break;
            }
            boolean hasMore = fetched.size() > NOTIFICATION_PAGE_SIZE;
            List<LeagueRankingRow> page = hasMore
                    ? fetched.subList(0, NOTIFICATION_PAGE_SIZE) : fetched;
            processedCount += sendMissedFocusPage(page, startToday, startTomorrow, now);
            entityManager.flush();
            entityManager.clear();
            if (!hasMore) {
                break;
            }
            LeagueRankingRow lastRow = page.get(page.size() - 1);
            cursorFocusSeconds = lastRow.totalFocusSeconds();
            cursorUserId = lastRow.userId();
        }
        log.info("오늘 미집중 알림 — 대상 {}건 처리 완료 (today={})", processedCount, today);
    }

    private int sendMissedFocusPage(List<LeagueRankingRow> page, Instant startToday, Instant startTomorrow,
                                    Instant now) {
        // 이번 주 참여자(누적>0)만 대상 — 완전 미접속 유저는 결석 복귀(GROMO-578)가 담당
        List<UUID> participantIds = page.stream()
                .filter(row -> row.totalFocusSeconds() > 0)
                .map(LeagueRankingRow::userId)
                .toList();
        if (participantIds.isEmpty()) {
            return 0;
        }
        Set<UUID> focusedTodayIds = new HashSet<>(focusSessionRepository
                .findUserIdsWithSessionStartedBetween(participantIds, startToday, startTomorrow));
        List<UUID> targetIds = participantIds.stream()
                .filter(id -> !focusedTodayIds.contains(id))
                .toList();
        if (targetIds.isEmpty()) {
            return 0;
        }
        Map<UUID, User> usersById = loadUsers(targetIds);
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(targetIds);
        int processedCount = 0;
        for (UUID userId : targetIds) {
            User user = usersById.get(userId);
            if (user == null) {
                continue;
            }
            UserNotificationSettings settings = settingsByUserId.get(userId);
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            pushNotificationService.sendIfAllowed(user, settings, composeMissedFocusToday(soundEnabled), now);
            processedCount++;
        }
        return processedCount;
    }

    /** 스트릭 위기 알림 — 스케줄러(매일 22:00 KST)·수동 트리거 진입점. */
    public void sendStreakAtRisk() {
        sendStreakAtRisk(Instant.now());
    }

    public void sendStreakAtRisk(Instant now) {
        LocalDate today = leagueWeek.currentDate(now);
        List<UserStreak> streakHolders =
                userStreakRepository.findByStreakCountGreaterThanAndDeletedAtIsNull(0);
        if (streakHolders.isEmpty()) {
            log.info("스트릭 위기 알림 — 대상 없음 (today={})", today);
            return;
        }
        int processedCount = 0;
        for (int start = 0; start < streakHolders.size(); start += NOTIFICATION_PAGE_SIZE) {
            List<UserStreak> chunk = streakHolders.subList(
                    start, Math.min(start + NOTIFICATION_PAGE_SIZE, streakHolders.size()));
            processedCount += sendStreakAtRiskChunk(chunk, today, now);
            entityManager.flush();
            entityManager.clear();
        }
        log.info("스트릭 위기 알림 — 대상 {}건 처리 완료 (today={})", processedCount, today);
    }

    private int sendStreakAtRiskChunk(List<UserStreak> chunk, LocalDate today, Instant now) {
        List<UUID> userIds = chunk.stream().map(UserStreak::getUserId).toList();
        Map<UUID, User> usersById = loadUsers(userIds);
        if (usersById.isEmpty()) {
            return 0;
        }
        Map<UUID, Integer> todaySecondsByUser = dailyFocusStatRepository
                .findByUserInAndDate(usersById.values(), today).stream()
                .collect(Collectors.toMap(stat -> stat.getUser().getId(), DailyFocusStat::getTotalFocusSeconds));
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);
        int processedCount = 0;
        for (UserStreak streak : chunk) {
            User user = usersById.get(streak.getUserId());
            if (user == null) {
                continue;
            }
            if (todaySecondsByUser.getOrDefault(streak.getUserId(), 0) >= STREAK_MIN_SECONDS) {
                continue; // 오늘 이미 출석 인정(10분↑) → 위기 아님
            }
            UserNotificationSettings settings = settingsByUserId.get(streak.getUserId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            pushNotificationService.sendIfAllowed(
                    user, settings, composeStreakAtRisk(streak.getStreakCount(), soundEnabled), now);
            processedCount++;
        }
        return processedCount;
    }

    private Map<UUID, User> loadUsers(Collection<UUID> userIds) {
        return userRepository.findAllByIdInAndIsDeletedFalse(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
    }

    private Map<UUID, UserNotificationSettings> loadSettings(Collection<UUID> userIds) {
        return userNotificationSettingsRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
    }

    private PushMessage composeMissedFocusToday(boolean soundEnabled) {
        return new PushMessage(
                "오늘 아직 0분!",
                "지금 순위 밀리는 중이야. 딱 10분만 몰입해볼까?",
                "gromo://focus",
                soundEnabled);
    }

    private PushMessage composeStreakAtRisk(int streakCount, boolean soundEnabled) {
        return new PushMessage(
                "출석 " + streakCount + "일 끊기기 직전!",
                "10분만 채우면 연속 출석 유지! 지금 시작하자",
                "gromo://focus",
                soundEnabled);
    }
}
