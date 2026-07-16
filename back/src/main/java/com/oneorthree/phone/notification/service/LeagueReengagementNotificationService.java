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
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
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
            processedCount += sendMissedFocusPage(page, today, now);
            entityManager.flush();
            entityManager.clear();
            LeagueRankingRow lastRow = page.get(page.size() - 1);
            // 랭킹은 누적 DESC 정렬 — 페이지 끝이 0초면 이후 페이지는 전부 미참여자라
            // 커서를 유저 테이블 끝까지 헛돌릴 필요 없이 중단한다.
            if (!hasMore || lastRow.totalFocusSeconds() == 0) {
                break;
            }
            cursorFocusSeconds = lastRow.totalFocusSeconds();
            cursorUserId = lastRow.userId();
        }
        log.info("오늘 미집중 알림 — 대상 {}건 처리 완료 (today={})", processedCount, today);
    }

    private int sendMissedFocusPage(List<LeagueRankingRow> page, LocalDate today, Instant now) {
        // 이번 주 참여자(누적>0)만 대상 — 완전 미접속 유저는 결석 복귀(GROMO-578)가 담당
        List<UUID> participantIds = page.stream()
                .filter(row -> row.totalFocusSeconds() > 0)
                .map(LeagueRankingRow::userId)
                .toList();
        if (participantIds.isEmpty()) {
            return 0;
        }
        // 오늘 이미 집중한 유저 = 오늘자 DailyFocusStat>0(완료 집중, 자정 넘겨 끝난 세션도 종료일 귀속으로 포함)
        //                        ∪ 지금 진행 중(라이브) 세션 보유.
        // startedAt 기준을 쓰지 않는다 — orphan 자동종료(AUTO_CLOSED) 세션은 실집중 0인데도 startedAt 에 걸려
        // '오늘 집중함'으로 오판, 버려진 세션 뒤 재참여 대상에서 빠지는 오검출을 유발한다(통계는 완료 시에만 기록).
        Set<UUID> focusedTodayIds = new HashSet<>(
                dailyFocusStatRepository.findUserIdsWithFocusOnDate(participantIds, today));
        focusedTodayIds.addAll(focusSessionRepository.findUserIdsWithOpenSession(participantIds));
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
        // 마지막 세션이 어제 이후인(오늘 채우면 유지되는) 스트릭만 — 이미 끊긴 스트릭은 lazy reset 전이라
        // streakCount 가 양수로 남아있어, 필터 없이는 매일 밤 "끊길라" 헛 알림이 간다.
        // userId 키셋 페이징 — 전체를 한 List 로 적재하지 않아 대량 스트릭 보유자에서도 메모리·트랜잭션 작업량을 제한.
        LocalDate minLastSessionDate = today.minusDays(1);
        int processedCount = 0;
        UUID cursorUserId = null;
        while (true) {
            List<UserStreak> fetched = userStreakRepository.findActiveStreakHoldersPage(
                    0, minLastSessionDate, cursorUserId, PageRequest.of(0, NOTIFICATION_PAGE_SIZE + 1));
            if (fetched.isEmpty()) {
                break;
            }
            boolean hasMore = fetched.size() > NOTIFICATION_PAGE_SIZE;
            List<UserStreak> chunk = hasMore ? fetched.subList(0, NOTIFICATION_PAGE_SIZE) : fetched;
            UUID lastUserId = chunk.get(chunk.size() - 1).getUserId();
            processedCount += sendStreakAtRiskChunk(chunk, today, now);
            entityManager.flush();
            entityManager.clear();
            if (!hasMore) {
                break;
            }
            cursorUserId = lastUserId;
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
        // 지금 집중 중(라이브 세션) 유저 — 완료 통계(DailyFocusStat)는 세션 종료 시에만 기록되므로, 22시에 이미
        // 10분 넘게 집중 중이어도 여기선 <600 으로 보인다. 실제로는 스트릭을 채우는 중이라 "끊길라" 넛지는 방해 →
        // 진행 중 세션 보유자는 위기 대상에서 제외한다.
        Set<UUID> activelyFocusingIds = new HashSet<>(
                focusSessionRepository.findUserIdsWithOpenSession(userIds));
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);
        int processedCount = 0;
        for (UserStreak streak : chunk) {
            User user = usersById.get(streak.getUserId());
            if (user == null) {
                continue;
            }
            if (activelyFocusingIds.contains(streak.getUserId())) {
                continue; // 지금 집중 중(라이브 세션) → 곧 채워질 예정, 위기 아님
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
