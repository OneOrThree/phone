package com.oneorthree.phone.internal.notification.service;

import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.UserStreakRepository;
import com.oneorthree.phone.focus.repository.domain.UserStreak;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityRequest;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import com.oneorthree.phone.league.support.LeagueWeek;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/** 리텐션 생성 조건을 현재 정본으로 재확인한다. 기존 스캔과 같은 완료일·라이브·집계 축을 사용한다. */
@Component
@RequiredArgsConstructor
public class NotificationRetentionEligibility {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // LeagueReengagementNotificationService의 생성 조건: orphan 12h 제외, 출석 600초.
    private static final Duration LIVE_SESSION_MAX_AGE = Duration.ofHours(12);
    private static final int STREAK_MIN_SECONDS = 600;

    private final FocusSessionRepository focusSessions;
    private final DailyFocusStatRepository dailyStats;
    private final UserStreakRepository streaks;
    private final LeagueWeek leagueWeek;

    /** 시간 만료·수신자 활성 검사를 통과한 리텐션 3종만 들어온다. 관리자 시험도 현재 상태를 따른다. */
    public NotificationEligibilityResponse evaluate(NotificationEligibilityRequest request, User user, Instant now) {
        LocalDate today = leagueWeek.currentDate(now);
        if ("INACTIVE_RETURN".equals(request.kind())) {
            return inactiveReturn(request, user, today);
        }
        List<UUID> ids = List.of(user.getId());
        if (!focusSessions.findUserIdsWithLiveSession(ids, now.minus(LIVE_SESSION_MAX_AGE)).isEmpty()) {
            return NotificationEligibilityResponse.deny("CURRENTLY_FOCUSING");
        }
        if ("MISSED_FOCUS_TODAY".equals(request.kind())) {
            if (!focusSessions.findUserIdsWithCompletedFocusEndedBetween(ids,
                    today.atStartOfDay(KST).toInstant(), today.plusDays(1).atStartOfDay(KST).toInstant()).isEmpty()) {
                return NotificationEligibilityResponse.deny("ALREADY_FOCUSED_TODAY");
            }
            // 기존 전체 랭킹 후보와 같은 KST 주간 집계 및 온보딩 완료 조건이다.
            return user.getNickname() != null && !user.getNickname().isBlank()
                    && dailyStats.sumTotalFocusSecondsByUserAndDateBetween(user,
                            leagueWeek.currentWeekStartDate(now), today) > 0
                    ? NotificationEligibilityResponse.allow() : changed();
        }
        UserStreak streak = streaks.findByUser(user).orElse(null);
        if (streak == null || streak.getDeletedAt() != null || streak.currentStreakAsOf(today) <= 0) {
            return changed();
        }
        int todaySeconds = dailyStats.findByUserAndDate(user, today)
                .map(stat -> stat.getTotalFocusSeconds()).orElse(0);
        return todaySeconds < STREAK_MIN_SECONDS ? NotificationEligibilityResponse.allow()
                : NotificationEligibilityResponse.deny("STREAK_ALREADY_PRESERVED");
    }

    private NotificationEligibilityResponse inactiveReturn(
            NotificationEligibilityRequest request, User user, LocalDate today) {
        if (user.isGuest() || user.getLastActiveAt() == null) {
            return changed();
        }
        long days = ChronoUnit.DAYS.between(user.getLastActiveAt().atZone(KST).toLocalDate(), today);
        if (days != 3 && days != 7 && days != 14) {
            return changed();
        }
        // 생산자가 단계별 문구를 고른 사건은 현재 단계도 같아야 한다. 시험의 빈 params는 그대로 허용한다.
        Object stage = request.params().get("stage");
        return stage == null || ("D" + days).equals(stage)
                ? NotificationEligibilityResponse.allow() : changed();
    }

    private NotificationEligibilityResponse changed() {
        return NotificationEligibilityResponse.deny("RETENTION_CONDITION_CHANGED");
    }
}
