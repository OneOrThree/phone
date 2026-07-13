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

    // interim(오늘) 판정 테스트용 — 현재 순간(유저 존 오늘). Instant.now() 의존은 date==today 성립만 필요하므로 안전.
    private static final Instant TODAY_AT = Instant.now().truncatedTo(ChronoUnit.SECONDS);
    // 최종 보고(과거 날짜 추론) 테스트용 — 어제보다도 확실히 과거인 고정 시각(실제 '오늘'과 무관하게 결정론적).
    private static final Instant PAST_AT = Instant.parse("2020-01-01T00:00:00Z");
    private static final LocalDate PAST_DATE = PAST_AT.atZone(ZONE).toLocalDate(); // 2020-01-01

    private User normalUser() {
        return User.builder().id(USER_ID).isGuest(false).countryCode(COUNTRY_CODE).build();
    }

    // 명시적 isFinal — 결정론적. (isFinal=true 는 오늘/과거 무관하게 최종 보고로 처리)
    private ScreenTimeRequest request(Boolean clientAchieved, Integer actualMinutes, Instant reportedAt, Boolean isFinal) {
        return new ScreenTimeRequest(clientAchieved, actualMinutes, reportedAt, isFinal);
    }

    // GROMO-805: interim 서버 판정용 목표(분) 스텁 — goal>0 & actual<=goal 이면 달성.
    private void givenScreenTimeGoal(int goalMinutes) {
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(goalMinutes).build()));
    }

    // 목표 미설정(row 없음) — interim 서버 판정은 항상 false.
    private void givenNoScreenTimeGoal() {
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
    }

    private LocalDate todayDate() {
        return TODAY_AT.atZone(ZONE).toLocalDate();
    }

    // ── 최종 보고: 클라 신뢰 (isFinal=true, GROMO-805) ──────────────────────

    @Test
    @DisplayName("최종 보고(isFinal=true) & 클라 달성=true → 서버가 이견이어도(actual 80>goal 60) 클라 신뢰로 저장 true + 이벤트 + 알림")
    void finalReportTrustsClientAchievedEvenWhenServerWouldDisagree() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        // goal 은 최종 보고 판정에 쓰이지 않는다(클라 신뢰). 스텁하지 않아도 통과해야 정상.

        // 과거 날짜의 목표는 지금과 달랐을 수 있어 서버는 actual>goal 여도 클라의 달성을 신뢰한다.
        screenTimeService.saveScreenTime(USER_ID, request(true, 80, PAST_AT, true));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isTrue();
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isEqualTo(80);
        verify(userActivityEventLogger).log(UserActivityEvent.DAILY_SCREEN_TIME_GOAL_ACHIEVED,
                Map.of("date", PAST_DATE.toString(), "actual_screen_time_minutes", 80));
        verify(notificationPort).notify(USER_ID, true);
    }

    @Test
    @DisplayName("최종 보고(isFinal=true) & 클라 달성=false → 저장 false, 이벤트·알림 미발사")
    void finalReportClientNotAchievedStoresFalseAndNoEvent() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // 클라가 미달성(actual 30 이 goal 이내여도 클라 판정을 신뢰) → 저장 false.
        screenTimeService.saveScreenTime(USER_ID, request(false, 30, PAST_AT, true));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("과거 날짜 보고(reportedAt=과거, isFinal=null) → 최종으로 추론, 클라 달성 신뢰(true) → 저장 true + 이벤트 + 알림")
    void pastDateReportInferredAsFinalUsesClientFlag() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // isFinal 미지정(구버전 앱)이라도 과거 날짜면 마감으로 간주 → 클라 달성 신뢰.
        screenTimeService.saveScreenTime(USER_ID, request(true, 999, PAST_AT, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isTrue();
        verify(userActivityEventLogger).log(UserActivityEvent.DAILY_SCREEN_TIME_GOAL_ACHIEVED,
                Map.of("date", PAST_DATE.toString(), "actual_screen_time_minutes", 999));
        verify(notificationPort).notify(USER_ID, true);
    }

    @Test
    @DisplayName("과거 날짜 보고(isFinal=null) & 클라 달성=false → 최종 추론이나 미달성이므로 이벤트·알림 미발사")
    void pastDateReportClientNotAchievedNoEvent() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        screenTimeService.saveScreenTime(USER_ID, request(false, 10, PAST_AT, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    // ── interim(오늘): 서버 임시 판정 + 조기 알림 억제 (GROMO-805, Codex P1~P3) ──

    @Test
    @DisplayName("interim(오늘, isFinal=false) & 서버 판정 달성(90<=goal 120) → 저장 flag=true 지만 이벤트·알림 미발사(조기 알림 방지)")
    void interimAchievedStoresFlagButDoesNotEmit() {
        User user = normalUser();
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(todayDate()).isScreenTimeGoalAchieved(false).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate()))
                .willReturn(Optional.of(existing));
        givenScreenTimeGoal(120);

        // 오늘 & isFinal=false → interim. 서버 판정 true(90<=120) 이나 알림은 미룬다.
        screenTimeService.saveScreenTime(USER_ID, request(true, 90, TODAY_AT, false));

        assertThat(existing.isScreenTimeGoalAchieved()).isTrue();     // 저장 flag 는 서버 판정으로 갱신(805 조회 일관성)
        assertThat(existing.getTotalScreenTimeMinutes()).isEqualTo(90);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("interim(오늘, isFinal=null) & 서버 판정 미달성(200>goal 120) → 저장 false, 이벤트·알림 미발사")
    void interimOverGoalStoresFalseAndDoesNotEmit() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenScreenTimeGoal(120);

        // 클라가 달성 true 주장해도 interim 은 서버 판정(200>120 → false).
        screenTimeService.saveScreenTime(USER_ID, request(true, 200, TODAY_AT, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isEqualTo(200);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("interim(오늘) & actualScreenTimeMinutes null(측정 누락) → 서버 판정 false(달성 아님), 저장 0, 이벤트·알림 미발사 (Codex #2)")
    void interimNullActualMinutesIsNotAchieved() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenScreenTimeGoal(60);

        // 데이터 누락(null)을 0<=goal 로 달성 처리하던 버그 방지 → 저장 false.
        screenTimeService.saveScreenTime(USER_ID, request(true, null, TODAY_AT, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isEqualTo(0);
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();   // null → 미달성 (0<=60 로 세지 않음)
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("interim(오늘) & 목표 미설정(goal row 없음) → 서버 판정 false, 이벤트·알림 미발사")
    void interimNoGoalIsFalse() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));
        givenNoScreenTimeGoal();

        screenTimeService.saveScreenTime(USER_ID, request(true, 10, TODAY_AT, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();   // goal=0 → 판정 안 함
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    // ── upsert: 기존 레코드 갱신 ────────────────────────────────────────────

    @Test
    @DisplayName("기존 레코드 존재(최종 보고) → 신규 save 없이 필드 업데이트")
    void saveScreenTimeUpdatesExistingRecord() {
        User user = normalUser();
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(PAST_DATE).isScreenTimeGoalAchieved(false).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.of(existing));

        screenTimeService.saveScreenTime(USER_ID, request(true, 120, PAST_AT, true));

        assertThat(existing.isScreenTimeGoalAchieved()).isTrue();     // 최종 보고 → 클라 신뢰
        assertThat(existing.getTotalScreenTimeMinutes()).isEqualTo(120);
        verify(dailyScreenTimeStatRepository, never()).save(any());
        verify(notificationPort).notify(USER_ID, true);
    }

    // ── country_code 파생 ZoneId 환산 (date-bucketing) ─────────────────────

    @Test
    @DisplayName("KST 자정 경계 → 유저 country_code(KR) 파생 ZoneId 기준 로컬 날짜로 귀속")
    void saveScreenTimeUsesCountryZoneForLocalDate() {
        User user = normalUser(); // KR
        // 2020-01-01T15:30:00Z == 2020-01-02 00:30 KST → 로컬 날짜 01-02 (UTC 였다면 01-01 로 오귀속)
        Instant reportedAt = Instant.parse("2020-01-01T15:30:00Z");
        LocalDate kstDate = LocalDate.of(2020, 1, 2);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, kstDate))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // 과거 날짜라 최종으로 추론됨(goal 조회 불필요). date-bucketing 만 검증.
        screenTimeService.saveScreenTime(USER_ID, request(false, 60, reportedAt, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(kstDate);
    }

    @Test
    @DisplayName("country_code null → UTC 폴백 기준 로컬 날짜")
    void saveScreenTimeNullCountryFallsBackToUtc() {
        User user = User.builder().id(USER_ID).isGuest(false).build(); // countryCode null
        Instant reportedAt = Instant.parse("2020-01-01T15:30:00Z"); // UTC 로컬 날짜 01-01
        LocalDate utcDate = LocalDate.of(2020, 1, 1);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, utcDate))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        screenTimeService.saveScreenTime(USER_ID, request(false, 60, reportedAt, null));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getDate()).isEqualTo(utcDate);
    }

    // ── 에러 케이스 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("존재하지 않는 userId → UserException")
    void saveScreenTimeUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> screenTimeService.saveScreenTime(USER_ID, request(true, 100, TODAY_AT, null)))
                .isInstanceOf(UserException.class);
        verify(dailyScreenTimeStatRepository, never()).save(any());
    }
}
