package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserStreak;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class LeagueReengagementNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Instant NOW = Instant.parse("2026-07-15T12:00:00Z");
    private static final LocalDate WEEK_START_DATE = LocalDate.of(2026, 7, 13);
    private static final LocalDate TODAY = LocalDate.of(2026, 7, 15);
    private static final int FETCH_SIZE = LeagueReengagementNotificationService.NOTIFICATION_PAGE_SIZE + 1;
    private static final Instant START_TODAY = TODAY.atStartOfDay(KST).toInstant();
    private static final Instant START_TOMORROW = TODAY.plusDays(1).atStartOfDay(KST).toInstant();

    @Mock
    private LeagueRankingQueryRepository leagueRankingQueryRepository;
    @Mock
    private FocusSessionRepository focusSessionRepository;
    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;
    @Mock
    private UserStreakRepository userStreakRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;
    @Mock
    private PushNotificationService pushNotificationService;
    @Mock
    private LeagueWeek leagueWeek;
    @Mock
    private EntityManager entityManager;
    @InjectMocks
    private LeagueReengagementNotificationService service;

    private static User user(UUID id) {
        return User.builder().id(id).deviceToken("token-" + id).build();
    }

    private static LeagueRankingRow row(User user, int weeklySeconds) {
        return new LeagueRankingRow(user.getId(), "닉-" + user.getId(), 1, weeklySeconds);
    }

    private static UserStreak streak(UUID userId, int count) {
        return UserStreak.builder().userId(userId).streakCount(count).build();
    }

    private static DailyFocusStat dailyStat(User user, int seconds) {
        return DailyFocusStat.builder().user(user).totalFocusSeconds(seconds).build();
    }

    // ── 오늘 미집중 (평일 21:00) ────────────────────────────────────────────────

    @Test
    @DisplayName("오늘 미집중 — 이번 주 참여(누적>0) & 오늘 0분인 유저에게만 발송한다")
    void sendsMissedFocusOnlyToParticipantsWithoutTodayFocus() {
        User target = user(UUID.randomUUID());       // 참여 O, 오늘 집중 X → 발송
        User focusedToday = user(UUID.randomUUID());  // 참여 O, 오늘 집중 O → 미발송
        User nonParticipant = user(UUID.randomUUID()); // 이번 주 누적 0 → 미발송
        given(leagueWeek.currentWeekStartDate(NOW)).willReturn(WEEK_START_DATE);
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(leagueRankingQueryRepository.findGlobalRankingPage(
                eq(WEEK_START_DATE), eq(TODAY), isNull(), isNull(), eq(FETCH_SIZE)))
                .willReturn(List.of(
                        row(target, 5_000),
                        row(focusedToday, 3_000),
                        row(nonParticipant, 0)));
        given(focusSessionRepository.findUserIdsWithSessionStartedBetween(
                anyCollection(), eq(START_TODAY), eq(START_TOMORROW)))
                .willReturn(List.of(focusedToday.getId()));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection())).willReturn(List.of(target));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendMissedFocusToday(NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService, times(1)).sendIfAllowed(eq(target), any(), message.capture(), eq(NOW));
        assertThat(message.getValue().title()).isEqualTo("오늘 아직 0분!");
        assertThat(message.getValue().link()).isEqualTo("gromo://focus");
    }

    // ── 스트릭 위기 (밤 22:00) ──────────────────────────────────────────────────

    @Test
    @DisplayName("스트릭 위기 — 스트릭 진행 중 & 오늘 10분 미만인 유저에게만 발송하고 스트릭 일수를 표기한다")
    void sendsStreakAtRiskOnlyToUsersBelowThreshold() {
        User atRisk = user(UUID.randomUUID());  // streak 5, 오늘 300초(<600) → 발송
        User safe = user(UUID.randomUUID());    // streak 3, 오늘 700초(>=600) → 미발송
        given(leagueWeek.currentDate(NOW)).willReturn(TODAY);
        given(userStreakRepository.findByStreakCountGreaterThanAndDeletedAtIsNull(0))
                .willReturn(List.of(streak(atRisk.getId(), 5), streak(safe.getId(), 3)));
        given(userRepository.findAllByIdInAndIsDeletedFalse(anyCollection()))
                .willReturn(List.of(atRisk, safe));
        given(dailyFocusStatRepository.findByUserInAndDate(anyCollection(), eq(TODAY)))
                .willReturn(List.of(dailyStat(atRisk, 300), dailyStat(safe, 700)));
        given(userNotificationSettingsRepository.findAllById(any())).willReturn(List.of());

        service.sendStreakAtRisk(NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(pushNotificationService, times(1)).sendIfAllowed(eq(atRisk), any(), message.capture(), eq(NOW));
        verify(pushNotificationService, never()).sendIfAllowed(eq(safe), any(), any(), any());
        assertThat(message.getValue().title()).contains("5");
        assertThat(message.getValue().link()).isEqualTo("gromo://focus");
    }

    @Test
    @DisplayName("스트릭 위기 — 진행 중 스트릭이 없으면 발송하지 않는다")
    void skipsStreakAtRiskWhenNoActiveStreaks() {
        given(userStreakRepository.findByStreakCountGreaterThanAndDeletedAtIsNull(0))
                .willReturn(List.of());

        service.sendStreakAtRisk(NOW);

        verify(pushNotificationService, never()).sendIfAllowed(any(), any(), any(), any());
        verify(userRepository, never()).findAllByIdInAndIsDeletedFalse(anyCollection());
    }
}
