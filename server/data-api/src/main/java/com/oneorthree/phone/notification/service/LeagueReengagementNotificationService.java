package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.repository.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.support.LeagueWeek;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.focus.repository.domain.UserStreak;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.focus.repository.UserStreakRepository;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
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

    /**
     * 라이브(진행 중) 세션으로 인정하는 최대 경과 — 이보다 오래된 미종료 세션은 아직 청소 안 된 orphan(버려진 세션)으로 보고 제외.
     * FocusService.ORPHAN_TIMEOUT(GROMO-804)과 동일해야 한다 — orphan sweeper 가 이 경과 이후 AUTO_CLOSED 처리하는데,
     * 스윕과 알림이 같은 정각에 돌아 스윕이 늦으면 미종료로 남은 버려진 세션을 '라이브'로 오인해 과억제하기 때문.
     */
    private static final Duration LIVE_SESSION_MAX_AGE = Duration.ofHours(12);

    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final UserStreakRepository userStreakRepository;
    private final UserQueryService userQueryService;
    private final PushNotificationService pushNotificationService;
    private final LeagueWeek leagueWeek;
    private final EntityManager entityManager;

    /** 오늘 미집중 알림 — 스케줄러(평일 21:00 KST)·수동 트리거 진입점. */
    public void sendMissedFocusToday() {
        sendMissedFocusToday(Instant.now());
    }

    /**
     * 오늘 아직 한 번도 집중하지 않은 참가자에게 알린다.
     *
     * @param now 오늘이 언제인지와 조용한 시간을 판정하는 기준 시각. 21:00 발송이라 기본
     *            조용한 시간(23:00~07:00) 밖이지만, 시작을 앞당긴 유저는 이 단계에서 걸러진다
     */
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
        // 오늘 이미 집중한 유저 = 오늘(KST 하루)에 종료된 완료 세션 ∪ 지금 진행 중(라이브) 세션.
        // 완료 판정은 endedAt 이 KST 오늘 구간에 든 세션(취소·orphan 자동종료 제외)으로 본다 —
        // 자정을 넘겨 끝난 세션도 종료일 기준이라 포함되기 때문. 사전집계(DailyFocusStat.date) 조회로 바꾸지 말 것.
        // (도입 당시엔 "DailyFocusStat.date 가 country_code 존 버킷이라 KST 오늘과 어긋난다"는 근거도 있었으나,
        //  GROMO-1259 의 저장축 KST 고정으로 그 근거는 해소됐다. 위 자정 경계 이유만으로 이 윈도우를 유지한다.)
        // startedAt 기준을 쓰지 않는다 — orphan 자동종료(AUTO_CLOSED)·미종료 세션은 실집중 0인데도 '오늘 집중함'으로 오판되기 때문.
        Instant startToday = today.atStartOfDay(KST).toInstant();
        Instant startTomorrow = today.plusDays(1).atStartOfDay(KST).toInstant();
        Set<UUID> focusedTodayIds = new HashSet<>(focusSessionRepository
                .findUserIdsWithCompletedFocusEndedBetween(participantIds, startToday, startTomorrow));
        focusedTodayIds.addAll(focusSessionRepository
                .findUserIdsWithLiveSession(participantIds, now.minus(LIVE_SESSION_MAX_AGE)));
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

    /**
     * 오늘 채우면 유지되는 스트릭 보유자에게 위기를 알린다.
     *
     * @param now 오늘 날짜 판정의 기준 시각. 이미 끊긴 스트릭은 아직 0 으로 정리되기 전이라
     *            숫자가 남아 있으므로, 마지막 세션 날짜로 한 번 더 걸러 헛 알림을 막는다
     */
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
        // 진행 중 세션 보유자는 위기 대상에서 제외한다. 단 orphan 타임아웃(12h)을 넘긴 미종료 세션은 청소 대기 중인
        // 버려진 세션이라 라이브로 치지 않는다(스윕과 알림이 같은 정각에 돌아 스윕이 늦을 때 오분류 방지).
        Set<UUID> activelyFocusingIds = new HashSet<>(focusSessionRepository
                .findUserIdsWithLiveSession(userIds, now.minus(LIVE_SESSION_MAX_AGE)));
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
        return userQueryService.findAllActive(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
    }

    private Map<UUID, UserNotificationSettings> loadSettings(Collection<UUID> userIds) {
        return userQueryService.findAllNotificationSettings(userIds).stream()
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
