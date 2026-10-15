package com.oneorthree.phone.internal.notification;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.UserStreakRepository;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionStatus;
import com.oneorthree.phone.focus.repository.domain.UserStreak;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityRequest;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import com.oneorthree.phone.internal.notification.service.NotificationEligibilityService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/** 아직 만료되지 않은 지연 사건도 현재 코어 상태가 문구와 달라졌으면 evaluate에서 억제한다. */
@Transactional
class NotificationRetentionEligibilityIntegrationTest extends IntegrationTestBase {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Instant NOW = Instant.parse("2026-09-11T13:05:00Z"); // 금요일 KST 22:05
    private static final LocalDate TODAY = NOW.atZone(KST).toLocalDate();

    @Autowired NotificationEligibilityService eligibility;
    @Autowired UserRepository users;
    @Autowired FocusSessionRepository sessions;
    @Autowired DailyFocusStatRepository stats;
    @Autowired UserStreakRepository streaks;
    @MockitoBean Clock clock;
    private User user;

    @BeforeEach
    void setup() {
        when(clock.instant()).thenReturn(NOW);
        when(clock.getZone()).thenReturn(KST);
        user = users.saveAndFlush(User.builder().nickname("retention-" + UUID.randomUUID())
                .lastActiveAt(TODAY.minusDays(3).atStartOfDay(KST).toInstant()).build());
    }

    @ParameterizedTest
    @ValueSource(ints = {3, 7, 14})
    void returningAfterTheEventWasProducedSuppressesEveryReturnStage(int days) {
        user.setLastActiveAt(TODAY.minusDays(days).atStartOfDay(KST).toInstant());
        users.flush();
        Map<String, Object> params = Map.of("dedupAt", TODAY.atTime(10, 0).atZone(KST).toInstant().toString(),
                "stage", "D" + days);
        assertThat(evaluate("INACTIVE_RETURN", params, false).eligible()).isTrue();
        user.setLastActiveAt(NOW.minusSeconds(30));
        users.flush();
        assertDenied(evaluate("INACTIVE_RETURN", params, false), "RETENTION_CONDITION_CHANGED");
    }

    @Test
    void aDeclaredReturnStageMustStillMatchButMissingStageIsNotANewRequirement() {
        Map<String, Object> original = Map.of("dedupAt", NOW.minusSeconds(60).toString());
        assertThat(evaluate("INACTIVE_RETURN", original, false).eligible()).isTrue();
        assertDenied(evaluate("INACTIVE_RETURN", Map.of("dedupAt", NOW.minusSeconds(60).toString(),
                "stage", "D7"), false), "RETENTION_CONDITION_CHANGED");
    }

    @ParameterizedTest
    @CsvSource({"COMPLETED,false,false", "ACTIVE,false,false", "CANCELED,false,true",
            "AUTO_CLOSED,false,true", "ACTIVE,true,true"})
    void missedFocusUsesCompletedEndDayAndIgnoresCanceledOrOrphanSessions(
            FocusSessionStatus status, boolean orphan, boolean allowed) {
        weeklyParticipation();
        assertThat(evaluate("MISSED_FOCUS_TODAY").eligible()).isTrue();
        sessions.saveAndFlush(FocusSession.builder().user(user).status(status)
                .startedAt(orphan ? NOW.minusSeconds(43201) : TODAY.atStartOfDay(KST).toInstant().minusSeconds(60))
                .endedAt(orphan ? null : TODAY.atStartOfDay(KST).toInstant().plusSeconds(60)).build());
        NotificationEligibilityResponse result = evaluate("MISSED_FOCUS_TODAY");
        assertThat(result.eligible()).isEqualTo(allowed);
        if (!allowed) {
            assertThat(result.reason()).isEqualTo("ALREADY_FOCUSED_TODAY");
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"MISSED_FOCUS_TODAY", "STREAK_AT_RISK"})
    void aLiveFocusStartedAfterTheEventPreventsTheNudge(String kind) {
        weeklyParticipation();
        activeStreak();
        assertThat(evaluate(kind).eligible()).isTrue();
        sessions.saveAndFlush(FocusSession.builder().user(user).startedAt(NOW.minusSeconds(1)).build());
        assertDenied(evaluate(kind), "CURRENTLY_FOCUSING");
    }

    @Test
    void missedFocusRequiresCurrentWeeklyParticipation() {
        assertDenied(evaluate("MISSED_FOCUS_TODAY"), "RETENTION_CONDITION_CHANGED");
        DailyFocusStat earlier = weeklyParticipation();
        assertThat(evaluate("MISSED_FOCUS_TODAY").eligible()).isTrue();
        earlier.setTotalFocusSeconds(0);
        stats.flush();
        assertDenied(evaluate("MISSED_FOCUS_TODAY"), "RETENTION_CONDITION_CHANGED");
    }

    @Test
    void reachingTenMinutesAfterTheStreakEventSuppressesIt() {
        activeStreak();
        DailyFocusStat today = stats.saveAndFlush(DailyFocusStat.builder().user(user).date(TODAY)
                .totalFocusSeconds(599).build());
        assertThat(evaluate("STREAK_AT_RISK").eligible()).isTrue();
        today.setTotalFocusSeconds(600);
        stats.flush();
        assertDenied(evaluate("STREAK_AT_RISK"), "STREAK_ALREADY_PRESERVED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "zero", "broken", "deleted"})
    void aStreakMustStillBePresentAndContinuable(String change) {
        UserStreak streak = activeStreak();
        assertThat(evaluate("STREAK_AT_RISK").eligible()).isTrue();
        switch (change) {
            case "missing" -> streaks.delete(streak);
            case "zero" -> streak.setStreakCount(0);
            case "broken" -> streak.setLastSessionDate(TODAY.minusDays(2));
            case "deleted" -> streak.setDeletedAt(NOW);
            default -> throw new IllegalArgumentException(change);
        }
        streaks.flush();
        assertDenied(evaluate("STREAK_AT_RISK"), "RETENTION_CONDITION_CHANGED");
    }

    @Test
    void retentionStateStillAppliesToAuthenticatedAdminTestsWithoutAddingRequiredParams() {
        assertThat(evaluate("INACTIVE_RETURN", Map.of(), true).eligible()).isTrue();
        user.setLastActiveAt(NOW);
        users.flush();
        assertDenied(evaluate("INACTIVE_RETURN", Map.of(), true), "RETENTION_CONDITION_CHANGED");
        weeklyParticipation();
        activeStreak();
        assertThat(evaluate("MISSED_FOCUS_TODAY", Map.of(), true).eligible()).isTrue();
        assertThat(evaluate("STREAK_AT_RISK", Map.of(), true).eligible()).isTrue();
        sessions.saveAndFlush(FocusSession.builder().user(user).startedAt(NOW.minusSeconds(60)).build());
        assertDenied(evaluate("MISSED_FOCUS_TODAY", Map.of(), true), "CURRENTLY_FOCUSING");
        assertDenied(evaluate("STREAK_AT_RISK", Map.of(), true), "CURRENTLY_FOCUSING");
    }

    @Test
    void existingExpiryTakesPrecedenceOverCurrentRetentionState() {
        assertDenied(evaluate("MISSED_FOCUS_TODAY", Map.of("dedupAt", NOW.minusSeconds(86400).toString()), false),
                "EVENT_EXPIRED");
    }

    private DailyFocusStat weeklyParticipation() {
        return stats.saveAndFlush(DailyFocusStat.builder().user(user).date(TODAY.minusDays(1))
                .totalFocusSeconds(600).build());
    }

    private UserStreak activeStreak() {
        return streaks.saveAndFlush(UserStreak.builder().user(user).streakCount(5)
                .lastSessionDate(TODAY.minusDays(1)).build());
    }

    private NotificationEligibilityResponse evaluate(String kind) {
        return evaluate(kind, Map.of("dedupAt", NOW.minusSeconds(60).toString()), false);
    }

    private NotificationEligibilityResponse evaluate(String kind, Map<String, Object> params, boolean admin) {
        return eligibility.evaluate(new NotificationEligibilityRequest(user.getId(), kind, null, params,
                admin ? NOW : null));
    }

    private void assertDenied(NotificationEligibilityResponse response, String reason) {
        assertThat(response.eligible()).isFalse();
        assertThat(response.reason()).isEqualTo(reason);
    }
}
