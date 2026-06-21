package com.oneorthree.phone.service;

import com.oneorthree.phone.focus.domain.DailyFocusStat;
import com.oneorthree.phone.screentime.service.ScreenTimeService;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserNotFoundException;
import com.oneorthree.phone.common.port.ScreenTimeNotificationPort;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
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
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private ScreenTimeNotificationPort notificationPort;

    private static final Long USER_ID = 1L;
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
    @DisplayName("daily_focus_stats 있을 때 → 필드 업데이트, 알림 호출")
    void saveScreenTimeUpdatesExistingRecord() {
        // given
        User user = normalUser();
        DailyFocusStat existing = DailyFocusStat.builder()
                .user(user).date(expectedDate()).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.of(existing));

        // when
        screenTimeService.saveScreenTime(USER_ID, request(true, 120));

        // then
        assertThat(existing.isScreenTimeGoalAchieved()).isTrue();
        assertThat(existing.getActualScreenTimeMinutes()).isEqualTo(120);
        verify(dailyFocusStatRepository, never()).save(any());
        verify(notificationPort).notify(USER_ID, true);
    }

    @Test
    @DisplayName("daily_focus_stats 없을 때 → 신규 생성, 알림 호출")
    void saveScreenTimeCreatesNewRecord() {
        // given
        User user = normalUser();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // when
        screenTimeService.saveScreenTime(USER_ID, request(false, 200));

        // then
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        assertThat(captor.getValue().getActualScreenTimeMinutes()).isEqualTo(200);
        verify(notificationPort).notify(USER_ID, false);
    }

    @Test
    @DisplayName("actualScreenTimeMinutes null → 0으로 저장")
    void saveScreenTimeNullActualMinutesDefaultsToZero() {
        // given
        User user = normalUser();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyFocusStatRepository.save(any(DailyFocusStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // when
        screenTimeService.saveScreenTime(USER_ID, request(true, null));

        // then
        ArgumentCaptor<DailyFocusStat> captor = ArgumentCaptor.forClass(DailyFocusStat.class);
        verify(dailyFocusStatRepository).save(captor.capture());
        assertThat(captor.getValue().getActualScreenTimeMinutes()).isEqualTo(0);
    }

    // ── 에러 케이스 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("존재하지 않는 userId → UserNotFoundException")
    void saveScreenTimeUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> screenTimeService.saveScreenTime(USER_ID, request(true, 100)))
                .isInstanceOf(UserNotFoundException.class);
        verify(dailyFocusStatRepository, never()).save(any());
    }

    @Test
    @DisplayName("유효하지 않은 timeZone → ZoneRulesException")
    void saveScreenTimeInvalidTimeZone() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(normalUser()));
        ScreenTimeRequest badRequest = new ScreenTimeRequest(true, 100, REPORTED_AT, "Invalid/Zone");

        // when & then
        assertThatThrownBy(() -> screenTimeService.saveScreenTime(USER_ID, badRequest))
                .isInstanceOf(ZoneRulesException.class);
    }
}
