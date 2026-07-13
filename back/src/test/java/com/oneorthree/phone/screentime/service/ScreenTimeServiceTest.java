package com.oneorthree.phone.screentime.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.port.ScreenTimeNotificationPort;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
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
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyMap;
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
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    @Mock
    private ScreenTimeNotificationPort notificationPort;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final String COUNTRY_CODE = "KR";
    private static final ZoneId ZONE = ZoneId.of("Asia/Seoul"); // KR 파생 ZoneId
    private static final Instant REPORTED_AT = Instant.now().truncatedTo(ChronoUnit.SECONDS);

    private User normalUser() {
        return User.builder().id(USER_ID).isGuest(false).countryCode(COUNTRY_CODE).build();
    }

    // 중간 동기화(isFinal 생략=null) — 목표 달성 알림/이벤트를 발사하지 않는다.
    private ScreenTimeRequest request(Boolean goalAchieved, Integer actualMinutes) {
        return new ScreenTimeRequest(goalAchieved, actualMinutes, REPORTED_AT, null);
    }

    // 최종 보고(isFinal=true) — 서버 판정 달성이면 이벤트+알림을 발사한다.
    private ScreenTimeRequest finalRequest(Boolean goalAchieved, Integer actualMinutes) {
        return new ScreenTimeRequest(goalAchieved, actualMinutes, REPORTED_AT, true);
    }

    // GROMO-805: 서버 판정용 목표(분) 스텁 — goal>0 & actual<=goal 이면 달성.
    private void givenScreenTimeGoal(int goalMinutes) {
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(goalMinutes).build()));
    }

    // 목표 미설정(row 없음) — 서버 판정은 항상 false.
    private void givenNoScreenTimeGoal() {
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
    }

    private LocalDate expectedDate() {
        return REPORTED_AT.atZone(ZONE).toLocalDate();
    }

    // ── 정상 저장 (서버 판정, GROMO-805) ────────────────────────────────────

    @Test
    @DisplayName("daily_screen_time_stats 있을 때(최종 보고) → 필드 업데이트, 서버 판정(120<=goal 120)=true, 알림 호출")
    void saveScreenTimeUpdatesExistingRecord() {
        User user = normalUser();
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(expectedDate()).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.of(existing));
        givenScreenTimeGoal(120);   // 120 <= 120 → 서버 판정 true

        screenTimeService.saveScreenTime(USER_ID, finalRequest(true, 120));

        assertThat(existing.isScreenTimeGoalAchieved()).isTrue();
        assertThat(existing.getTotalScreenTimeMinutes()).isEqualTo(120);
        verify(dailyScreenTimeStatRepository, never()).save(any());
        verify(notificationPort).notify(USER_ID, true);
    }

    @Test
    @DisplayName("daily_screen_time_stats 없을 때(중간 동기화) → 신규 생성, 서버 판정(200>goal 120)=false, 알림 미호출")
    void saveScreenTimeCreatesNewRecord() {
        User user = normalUser();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenScreenTimeGoal(120);   // 200 > 120 → 서버 판정 false

        screenTimeService.saveScreenTime(USER_ID, request(false, 200));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isEqualTo(200);
        // 중간 동기화 & 미달성 → 알림 미발사
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("actualScreenTimeMinutes null → 0으로 저장(서버 판정 0<=goal → true)")
    void saveScreenTimeNullActualMinutesDefaultsToZero() {
        User user = normalUser();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenScreenTimeGoal(60);

        screenTimeService.saveScreenTime(USER_ID, request(true, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isEqualTo(0);
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isTrue();   // 0 <= 60
    }

    // ── 서버 판정 (클라 신뢰 제거, GROMO-805) ────────────────────────────────

    @Test
    @DisplayName("클라가 달성=true 보내도 서버 goal(60) 초과(80) → false 로 저장(클라 신뢰 제거)")
    void saveScreenTimeIgnoresClientFlagWhenOverGoal() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenScreenTimeGoal(60);

        // 클라는 달성 true 주장하지만 80 > 60 → 서버 판정 false
        screenTimeService.saveScreenTime(USER_ID, request(true, 80));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        // 서버 판정 false → 이벤트·알림 미발사
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
    }

    @Test
    @DisplayName("목표 미설정(goal row 없음) → 클라가 true 여도 서버 판정 false")
    void saveScreenTimeNoGoalIsFalse() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenNoScreenTimeGoal();

        screenTimeService.saveScreenTime(USER_ID, request(true, 10));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();   // goal=0 → 판정 안 함
        // 서버 판정 false → 알림 미발사
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    // ── country_code 파생 ZoneId 환산 ─────────────────────────────────────

    @Test
    @DisplayName("KST 자정 경계 → 유저 country_code(KR) 파생 ZoneId 기준 로컬 날짜로 귀속")
    void saveScreenTimeUsesCountryZoneForLocalDate() {
        User user = normalUser(); // KR
        // 2026-06-29T15:30:00Z == 2026-06-30 00:30 KST → 로컬 날짜 06-30 (UTC 였다면 06-29 로 오귀속)
        Instant reportedAt = Instant.parse("2026-06-29T15:30:00Z");
        LocalDate kstDate = LocalDate.of(2026, 6, 30);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, kstDate))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenNoScreenTimeGoal();

        screenTimeService.saveScreenTime(USER_ID,
                new ScreenTimeRequest(true, 60, reportedAt, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(kstDate);
    }

    @Test
    @DisplayName("country_code null → UTC 폴백 기준 로컬 날짜")
    void saveScreenTimeNullCountryFallsBackToUtc() {
        User user = User.builder().id(USER_ID).isGuest(false).build(); // countryCode null
        Instant reportedAt = Instant.parse("2026-06-29T15:30:00Z"); // UTC 로컬 날짜 06-29
        LocalDate utcDate = LocalDate.of(2026, 6, 29);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, utcDate))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenNoScreenTimeGoal();

        screenTimeService.saveScreenTime(USER_ID,
                new ScreenTimeRequest(true, 60, reportedAt, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(utcDate);
    }

    // ── DAILY_SCREEN_TIME_GOAL_ACHIEVED 이벤트 (GROMO-395, 최종 보고 게이트 — Codex P1) ──

    @Test
    @DisplayName("중간 동기화(isFinal=null) & 서버 판정 달성(90<=goal 120) → 저장 flag=true 지만 이벤트·알림 미발사(조기 알림 방지)")
    void saveScreenTimeInterimAchievedStoresFlagButDoesNotEmit() {
        User user = normalUser();
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(expectedDate()).isScreenTimeGoalAchieved(false).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.of(existing));
        givenScreenTimeGoal(120);

        // 중간 동기화(isFinal 생략) — 아직 한도를 넘을 수 있으므로 알림을 미루고 저장만 갱신한다.
        screenTimeService.saveScreenTime(USER_ID, request(true, 90));

        assertThat(existing.isScreenTimeGoalAchieved()).isTrue();   // 저장 flag 는 서버 판정으로 갱신(805 조회 일관성)
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("중간 동기화(isFinal=false 명시) & 서버 판정 달성 → 이벤트·알림 미발사")
    void saveScreenTimeInterimFalseFlagDoesNotEmit() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenScreenTimeGoal(120);

        screenTimeService.saveScreenTime(USER_ID,
                new ScreenTimeRequest(true, 90, REPORTED_AT, false));

        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("최종 보고(isFinal=true) & 서버 판정 달성(90<=goal 120) → DAILY_SCREEN_TIME_GOAL_ACHIEVED 발행 + 알림")
    void saveScreenTimeFinalAchievedEmitsEventAndNotifies() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenScreenTimeGoal(120);

        screenTimeService.saveScreenTime(USER_ID, finalRequest(true, 90));

        verify(userActivityEventLogger).log(UserActivityEvent.DAILY_SCREEN_TIME_GOAL_ACHIEVED,
                Map.of("date", expectedDate().toString(), "actual_screen_time_minutes", 90));
        verify(notificationPort).notify(USER_ID, true);
    }

    @Test
    @DisplayName("최종 보고(isFinal=true) & 서버 판정 미달성(200>goal 120) → 이벤트·알림 미발사")
    void saveScreenTimeFinalNotAchievedDoesNotEmit() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, expectedDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenScreenTimeGoal(120);

        screenTimeService.saveScreenTime(USER_ID, finalRequest(false, 200));

        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
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
