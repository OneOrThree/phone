package com.oneorthree.phone.screentime.service;

import com.oneorthree.phone.common.port.ScreenTimeNotificationPort;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
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
import java.time.temporal.ChronoUnit;
import java.time.zone.ZoneRulesException;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ScreenTimeServiceTest {

    @InjectMocks
    private ScreenTimeService screenTimeService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private DailyScreenTimeStatRepository dailyScreenTimeStatRepository;

    @Mock
    private ScreenTimeNotificationPort notificationPort;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final String TIMEZONE = "Asia/Seoul";
    private static final Instant REPORTED_AT = Instant.now().truncatedTo(ChronoUnit.SECONDS);

    private User normalUser() {
        return User.builder().id(USER_ID).isGuest(false).build();
    }

    private ScreenTimeRequest request(Boolean goalAchieved, Integer actualMinutes) {
        return new ScreenTimeRequest(goalAchieved, actualMinutes, REPORTED_AT, TIMEZONE);
    }

    private LocalDate expectedDate() {
        return REPORTED_AT.atZone(ZoneId.of(TIMEZONE)).toLocalDate();
    }

    // ── 정상 저장 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("daily_screen_time_stats 있을 때 → 필드 업데이트, 알림 호출")
    void saveScreenTimeUpdatesExistingRecord() {
        User user = normalUser();
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(expectedDate()).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.of(existing));

        screenTimeService.saveScreenTime(USER_ID, request(true, 120));

        assertThat(existing.isScreenTimeGoalAchieved()).isTrue();
        assertThat(existing.getActualScreenTimeMinutes()).isEqualTo(120);
        verify(dailyScreenTimeStatRepository, never()).save(any());
        verify(notificationPort).notify(USER_ID, true);
    }

    @Test
    @DisplayName("daily_screen_time_stats 없을 때 → 신규 생성, 알림 호출")
    void saveScreenTimeCreatesNewRecord() {
        User user = normalUser();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        screenTimeService.saveScreenTime(USER_ID, request(false, 200));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        assertThat(captor.getValue().getActualScreenTimeMinutes()).isEqualTo(200);
        verify(notificationPort).notify(USER_ID, false);
    }

    @Test
    @DisplayName("actualScreenTimeMinutes null → 0으로 저장")
    void saveScreenTimeNullActualMinutesDefaultsToZero() {
        User user = normalUser();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        screenTimeService.saveScreenTime(USER_ID, request(true, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getActualScreenTimeMinutes()).isEqualTo(0);
    }

    // ── timeZone 환산 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("KST 자정 경계 → 요청 timeZone 기준 로컬 날짜로 귀속")
    void saveScreenTimeUsesRequestTimeZoneForLocalDate() {
        User user = normalUser();
        // 2026-06-29T15:30:00Z == 2026-06-30 00:30 KST → 로컬 날짜 06-30 (UTC 였다면 06-29 로 오귀속)
        Instant reportedAt = Instant.parse("2026-06-29T15:30:00Z");
        LocalDate kstDate = LocalDate.of(2026, 6, 30);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, kstDate))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        screenTimeService.saveScreenTime(USER_ID,
                new ScreenTimeRequest(true, 60, reportedAt, TIMEZONE));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(kstDate);
    }

    @Test
    @DisplayName("무효 timeZone → ZoneRulesException (400 매핑)")
    void saveScreenTimeInvalidTimeZoneThrows() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        assertThatThrownBy(() -> screenTimeService.saveScreenTime(USER_ID,
                new ScreenTimeRequest(true, 60, REPORTED_AT, "Not/AZone")))
                .isInstanceOf(ZoneRulesException.class);
        verify(dailyScreenTimeStatRepository, never()).save(any());
    }

    // ── 에러 케이스 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("존재하지 않는 userId → UserException")
    void saveScreenTimeUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> screenTimeService.saveScreenTime(USER_ID, request(true, 100)))
                .isInstanceOf(UserException.class);
        verify(dailyScreenTimeStatRepository, never()).save(any());
    }
}
