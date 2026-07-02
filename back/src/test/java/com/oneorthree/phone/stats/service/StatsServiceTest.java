package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.domain.UserStreak;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class StatsServiceTest {

    @InjectMocks
    private StatsService statsService;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;
    @Mock
    private DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    @Mock
    private UserStreakRepository userStreakRepository;
    @Mock
    private UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    @Mock
    private UserRepository userRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // ── getHeatmap ────────────────────────────────────────────────────────

    @Test
    @DisplayName("히트맵 — Dense: 범위 내 모든 날짜 반환, 데이터 없는 날은 0 셀")
    void getHeatmapDenseFill() {
        LocalDate from = LocalDate.of(2026, 6, 1);
        LocalDate to = LocalDate.of(2026, 6, 3);
        User user = User.builder().id(USER_ID).build();
        DailyFocusStat focusMid = DailyFocusStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 2))
                .totalFocusMinutes(120).sessionCount(2)
                .focusGoalAchieved(true)
                .build();
        DailyScreenTimeStat screenMid = DailyScreenTimeStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 2))
                .actualScreenTimeMinutes(30).screenTimeGoalAchieved(false)
                .build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(dailyFocusStatRepository.findByUserAndDateBetweenOrderByDateAsc(user, from, to))
                .willReturn(List.of(focusMid));
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(user, from, to))
                .willReturn(List.of(screenMid));

        List<HeatmapCellResponse> cells = statsService.getHeatmap(USER_ID, from, to);

        assertThat(cells).hasSize(3);
        assertThat(cells.get(0).date()).isEqualTo(from);
        assertThat(cells.get(0).totalFocusMinutes()).isZero();
        assertThat(cells.get(0).focusGoalAchieved()).isFalse();
        assertThat(cells.get(0).actualScreenTimeMinutes()).isZero();
        assertThat(cells.get(1).date()).isEqualTo(LocalDate.of(2026, 6, 2));
        assertThat(cells.get(1).totalFocusMinutes()).isEqualTo(120);
        assertThat(cells.get(1).sessionCount()).isEqualTo(2);
        assertThat(cells.get(1).focusGoalAchieved()).isTrue();
        assertThat(cells.get(1).actualScreenTimeMinutes()).isEqualTo(30);
        assertThat(cells.get(1).screenTimeGoalAchieved()).isFalse();
        assertThat(cells.get(2).date()).isEqualTo(to);
        assertThat(cells.get(2).totalFocusMinutes()).isZero();
    }

    @Test
    @DisplayName("히트맵 — from > to → StatsException")
    void getHeatmapReversedRange() {
        assertThatThrownBy(() ->
                statsService.getHeatmap(USER_ID, LocalDate.of(2026, 6, 3), LocalDate.of(2026, 6, 1)))
                .isInstanceOf(StatsException.class);
    }

    @Test
    @DisplayName("히트맵 — 범위 366일 초과 → StatsException")
    void getHeatmapRangeTooLarge() {
        LocalDate from = LocalDate.of(2025, 1, 1);
        LocalDate to = from.plusDays(366); // 367일

        assertThatThrownBy(() -> statsService.getHeatmap(USER_ID, from, to))
                .isInstanceOf(StatsException.class);
    }

    // ── getStreak ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("스트릭 — 기록 있으면 매핑")
    void getStreakMapped() {
        User user = User.builder().id(USER_ID).build();
        UserStreak streak = UserStreak.builder()
                .user(user).streakCount(5).longestStreak(10).lastSessionDate(LocalDate.of(2026, 6, 28))
                .build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(userStreakRepository.findByUser(user)).willReturn(Optional.of(streak));

        StreakResponse response = statsService.getStreak(USER_ID);

        assertThat(response.currentStreak()).isEqualTo(5);
        assertThat(response.longestStreak()).isEqualTo(10);
        assertThat(response.lastSessionDate()).isEqualTo(LocalDate.of(2026, 6, 28));
    }

    @Test
    @DisplayName("스트릭 — 기록 없으면 0/0/null")
    void getStreakNoRow() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(userStreakRepository.findByUser(user)).willReturn(Optional.empty());

        StreakResponse response = statsService.getStreak(USER_ID);

        assertThat(response.currentStreak()).isZero();
        assertThat(response.longestStreak()).isZero();
        assertThat(response.lastSessionDate()).isNull();
    }

    // ── getTodayStats ─────────────────────────────────────────────────────

    @Test
    @DisplayName("오늘 요약 — 달성 여부는 저장 플래그가 아니라 현재 목표로 재계산")
    void getTodayStatsFull() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        // 저장 플래그는 일부러 반대로 세팅 → 재계산이 이를 덮어쓰는지 검증
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.of(DailyFocusStat.builder()
                        .totalFocusMinutes(45).focusGoalAchieved(true).build()));
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.of(DailyScreenTimeStat.builder()
                        .actualScreenTimeMinutes(80).screenTimeGoalAchieved(false).build()));
        given(userFocusTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserFocusTimeSettings.builder()
                        .userId(USER_ID).dailyFocusTimeGoalMinutes(60).build()));
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build()));

        TodayStatsResponse response = statsService.getTodayStats(USER_ID);

        assertThat(response.focus().todayMinutes()).isEqualTo(45);
        assertThat(response.focus().goalMinutes()).isEqualTo(60);
        assertThat(response.focus().goalAchieved()).isFalse();
        assertThat(response.focus().progressPercent()).isEqualTo(75);
        assertThat(response.screenTime().todayMinutes()).isEqualTo(80);
        assertThat(response.screenTime().goalMinutes()).isEqualTo(120);
        assertThat(response.screenTime().goalAchieved()).isTrue();
        assertThat(response.screenTime().progressPercent()).isEqualTo(67); // round(80/120*100)=67
    }

    @Test
    @DisplayName("오늘 요약 — 집계·목표 row 없음 → 0/미달성/진행도 0")
    void getTodayStatsEmpty() {
        User user = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        TodayStatsResponse response = statsService.getTodayStats(USER_ID);

        assertThat(response.focus().todayMinutes()).isZero();
        assertThat(response.focus().goalMinutes()).isZero();
        assertThat(response.focus().goalAchieved()).isFalse();
        assertThat(response.focus().progressPercent()).isZero();
        assertThat(response.screenTime().todayMinutes()).isZero();
        assertThat(response.screenTime().progressPercent()).isZero();
    }

    @Test
    @DisplayName("오늘 요약 — 스크린타임 사용량 > 목표 → 진행도 100 초과(클램프 없음)")
    void getTodayStatsOverLimitNotClamped() {
        User user = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.of(DailyScreenTimeStat.builder()
                        .actualScreenTimeMinutes(150).screenTimeGoalAchieved(false).build()));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build()));

        TodayStatsResponse response = statsService.getTodayStats(USER_ID);

        assertThat(response.screenTime().progressPercent()).isEqualTo(125); // round(150/120*100)
        assertThat(response.screenTime().goalAchieved()).isFalse();         // 150 > 120 → 미달성
    }

    @Test
    @DisplayName("오늘 요약 — 서버 UTC 기준 날짜로 집계 조회")
    void getTodayStatsResolvesDateByUtc() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        statsService.getTodayStats(USER_ID);

        ArgumentCaptor<LocalDate> dateCaptor = ArgumentCaptor.forClass(LocalDate.class);
        verify(dailyFocusStatRepository).findByUserAndDate(eq(user), dateCaptor.capture());
        assertThat(dateCaptor.getValue()).isEqualTo(LocalDate.now(ZoneOffset.UTC));
    }

    @Test
    @DisplayName("오늘 요약 — 유저 없음 → UserException")
    void getTodayStatsUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> statsService.getTodayStats(USER_ID))
                .isInstanceOf(UserException.class);
    }

    // ── getFocusStatsByPeriod ─────────────────────────────────────────────

    // 고정 기준 날짜: 2026-07-03 (금요일, 이번 주 월요일 = 2026-06-29)
    private static final LocalDate FIXED_TODAY = LocalDate.of(2026, 7, 3);

    @Test
    @DisplayName("기간별 통계 DAY — 오늘·어제 데이터 있음 → totalFocusMinutes·prev·delta 정확")
    void getFocusStatsByPeriodDayNormal() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        // 오늘(current): 90분, 어제(previous): 60분
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(90);
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(60);

        FocusPeriodStatsResponse response = statsService.getFocusStatsByPeriod(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.period()).isEqualTo(StatsPeriod.DAY);
        assertThat(response.from()).isEqualTo(FIXED_TODAY);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        assertThat(response.totalFocusMinutes()).isEqualTo(90);
        assertThat(response.previousTotalFocusMinutes()).isEqualTo(60);
        assertThat(response.deltaMinutes()).isEqualTo(30);
    }

    @Test
    @DisplayName("기간별 통계 WEEK — 이번 주 월~오늘, 전주 동일 기간 경계 정확")
    void getFocusStatsByPeriodWeekNormal() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        // 2026-07-03 은 금요일 → 이번 주 월요일 = 2026-06-29, 전주 동일 구간 = 2026-06-22 ~ 2026-06-26
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        LocalDate prevMonday = LocalDate.of(2026, 6, 22);
        LocalDate prevFriday = LocalDate.of(2026, 6, 26);

        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, thisMonday, FIXED_TODAY)).willReturn(200);
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, prevMonday, prevFriday)).willReturn(150);

        FocusPeriodStatsResponse response = statsService.getFocusStatsByPeriod(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        assertThat(response.period()).isEqualTo(StatsPeriod.WEEK);
        assertThat(response.from()).isEqualTo(thisMonday);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        assertThat(response.totalFocusMinutes()).isEqualTo(200);
        assertThat(response.previousTotalFocusMinutes()).isEqualTo(150);
        assertThat(response.deltaMinutes()).isEqualTo(50);
    }

    @Test
    @DisplayName("기간별 통계 MONTH — 이번 달 1일~오늘, 전월 동일 기간 경계 정확")
    void getFocusStatsByPeriodMonthNormal() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        LocalDate thisMonthStart = LocalDate.of(2026, 7, 1);
        LocalDate prevMonthStart = LocalDate.of(2026, 6, 1);
        LocalDate prevMonthSameDay = LocalDate.of(2026, 6, 3);

        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, thisMonthStart, FIXED_TODAY)).willReturn(120);
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, prevMonthStart, prevMonthSameDay)).willReturn(100);

        FocusPeriodStatsResponse response = statsService.getFocusStatsByPeriod(USER_ID, StatsPeriod.MONTH, FIXED_TODAY);

        assertThat(response.period()).isEqualTo(StatsPeriod.MONTH);
        assertThat(response.from()).isEqualTo(thisMonthStart);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        assertThat(response.totalFocusMinutes()).isEqualTo(120);
        assertThat(response.previousTotalFocusMinutes()).isEqualTo(100);
        assertThat(response.deltaMinutes()).isEqualTo(20);
    }

    @Test
    @DisplayName("기간별 통계 DAY — 오늘 데이터 없음 → totalFocusMinutes=0, deltaMinutes=0-prev")
    void getFocusStatsByPeriodDayNoTodayData() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(0);
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(45);

        FocusPeriodStatsResponse response = statsService.getFocusStatsByPeriod(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.totalFocusMinutes()).isZero();
        assertThat(response.previousTotalFocusMinutes()).isEqualTo(45);
        assertThat(response.deltaMinutes()).isEqualTo(-45);
    }

    @Test
    @DisplayName("기간별 통계 WEEK — 구간 데이터 전혀 없음(신규 유저) → 모두 0")
    void getFocusStatsByPeriodWeekNoData() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                any(), any(), any())).willReturn(0);

        FocusPeriodStatsResponse response = statsService.getFocusStatsByPeriod(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        assertThat(response.totalFocusMinutes()).isZero();
        assertThat(response.previousTotalFocusMinutes()).isZero();
        assertThat(response.deltaMinutes()).isZero();
    }

    @Test
    @DisplayName("기간별 통계 MONTH — 전월 말일 처리: 3월 31일 → 전월 previousTo = 2월 28일")
    void getFocusStatsByPeriodMonthEndOfMonthHandling() {
        // 3월 31일 기준으로 조회 → 전월 구간 previousTo = 2월 28일 (Java LocalDate 자동 처리)
        LocalDate march31 = LocalDate.of(2026, 3, 31);
        LocalDate marchStart = LocalDate.of(2026, 3, 1);
        LocalDate febStart = LocalDate.of(2026, 2, 1);
        LocalDate feb28 = LocalDate.of(2026, 2, 28); // 2026년은 평년

        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, marchStart, march31)).willReturn(300);
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                user, febStart, feb28)).willReturn(200);

        FocusPeriodStatsResponse response = statsService.getFocusStatsByPeriod(USER_ID, StatsPeriod.MONTH, march31);

        assertThat(response.from()).isEqualTo(marchStart);
        assertThat(response.to()).isEqualTo(march31);
        assertThat(response.totalFocusMinutes()).isEqualTo(300);
        assertThat(response.previousTotalFocusMinutes()).isEqualTo(200);
        assertThat(response.deltaMinutes()).isEqualTo(100);
    }

    @Test
    @DisplayName("기간별 통계 WEEK — sumTotalFocusMinutesByUserAndDateBetween 2회 호출 시 from/to 구간 정확")
    void getFocusStatsByPeriodWeekCallsRepositoryWithCorrectBounds() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(dailyFocusStatRepository.sumTotalFocusMinutesByUserAndDateBetween(
                any(), any(), any())).willReturn(0);

        statsService.getFocusStatsByPeriod(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        ArgumentCaptor<LocalDate> fromCaptor = ArgumentCaptor.forClass(LocalDate.class);
        ArgumentCaptor<LocalDate> toCaptor = ArgumentCaptor.forClass(LocalDate.class);
        // 2회 호출 검증
        verify(dailyFocusStatRepository, times(2))
                .sumTotalFocusMinutesByUserAndDateBetween(eq(user), fromCaptor.capture(), toCaptor.capture());

        // 첫 번째 호출: current 구간 (이번 주 월요일~오늘). 2026-07-03은 금요일 → 월요일=2026-06-29
        assertThat(fromCaptor.getAllValues().get(0)).isEqualTo(LocalDate.of(2026, 6, 29));
        assertThat(toCaptor.getAllValues().get(0)).isEqualTo(FIXED_TODAY);
        // 두 번째 호출: previous 구간 (전주 월요일~전주 동일 요일)
        assertThat(fromCaptor.getAllValues().get(1)).isEqualTo(LocalDate.of(2026, 6, 22));
        assertThat(toCaptor.getAllValues().get(1)).isEqualTo(LocalDate.of(2026, 6, 26));
    }
}
