package com.oneorthree.phone.screentime.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
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

    // ── interim(오늘): total 만 갱신, 달성 flag 미변경 (GROMO-805 후속, Codex 재리뷰) ──

    @Test
    @DisplayName("interim(오늘, isFinal=false): total 만 저장, 신규 row 달성 flag 는 기본값 false, 이벤트·알림 미발사")
    void interimStoresTotalOnlyAndDoesNotSetFlag() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        // 클라가 달성 true 주장해도 interim 은 판정하지 않음 → 신규 row flag 기본값(false).
        screenTimeService.saveScreenTime(USER_ID, request(true, 90, TODAY_AT, false));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isEqualTo(90);
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse(); // interim 은 flag 를 세우지 않음
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("interim(오늘) & 기존 row 달성=true → total 만 갱신, 기존 flag(true) 보존, 이벤트·알림 미발사")
    void interimKeepsExistingAchievedFlag() {
        User user = normalUser();
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(todayDate()).isScreenTimeGoalAchieved(true).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate()))
                .willReturn(Optional.of(existing));

        // interim 은 클라 달성=false 여도 기존 flag 를 덮지 않는다(마감만 flag 확정).
        screenTimeService.saveScreenTime(USER_ID, request(false, 45, TODAY_AT, false));

        assertThat(existing.getTotalScreenTimeMinutes()).isEqualTo(45);
        assertThat(existing.isScreenTimeGoalAchieved()).isTrue(); // 기존 flag 보존
        verify(dailyScreenTimeStatRepository, never()).save(any());
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    @Test
    @DisplayName("interim(오늘) & actualScreenTimeMinutes null(측정 누락) → total 0 저장, flag 미설정, 이벤트·알림 미발사")
    void interimNullActualMinutesStoresZeroAndNoFlag() {
        User user = normalUser();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, todayDate()))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.save(any(DailyScreenTimeStat.class)))
                .willAnswer(i -> i.getArgument(0));

        screenTimeService.saveScreenTime(USER_ID, request(true, null, TODAY_AT, false));

        ArgumentCaptor<DailyScreenTimeStat> captor = ArgumentCaptor.forClass(DailyScreenTimeStat.class);
        verify(dailyScreenTimeStatRepository).save(captor.capture());
        assertThat(captor.getValue().getTotalScreenTimeMinutes()).isEqualTo(0); // null → 0
        assertThat(captor.getValue().isScreenTimeGoalAchieved()).isFalse();
        verify(notificationPort, never()).notify(any(UUID.class), anyBoolean());
    }

    // ── 최종 알림 dedup: 마감 재시도는 재발사하지 않음 (Codex P2) ──────────────

    @Test
    @DisplayName("마감 재시도(이미 달성=true 인 기존 row) → total 만 갱신, 이벤트·알림 재발사 안 함(날짜별 멱등)")
    void finalRetryOnAlreadyAchievedRowDoesNotReemit() {
        User user = normalUser();
        // 첫 마감으로 이미 달성 처리된 기존 row (retry 진입 상태).
        DailyScreenTimeStat existing = DailyScreenTimeStat.builder()
                .user(user).date(PAST_DATE).totalScreenTimeMinutes(40)
                .isScreenTimeGoalAchieved(true).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDate(user, PAST_DATE))
                .willReturn(Optional.of(existing));

        // 같은 날짜 마감 재업로드 — wasAchieved=true 이므로 재발사 없음.
        screenTimeService.saveScreenTime(USER_ID, request(true, 55, PAST_AT, true));

        assertThat(existing.isScreenTimeGoalAchieved()).isTrue();
        assertThat(existing.getTotalScreenTimeMinutes()).isEqualTo(55); // total 은 갱신
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), anyMap());
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
