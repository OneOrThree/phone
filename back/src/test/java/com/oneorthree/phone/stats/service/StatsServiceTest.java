package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.focus.domain.DefaultTag;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.domain.UserFocusTag;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.dto.CategoryFocusStatsResponse;
import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.ScreenTimePeriodStatsResponse;
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
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
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
    private FocusSessionRepository focusSessionRepository;
    @Mock
    private UserStreakRepository userStreakRepository;
    @Mock
    private UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    @Mock
    private UserRepository userRepository;
    // 기간 경계 계산은 무상태 실로직을 그대로 검증한다(@Spy) — 추출 후에도 경계 assertion 동일하게 유지.
    @Spy
    private StatsPeriodResolver statsPeriodResolver = new StatsPeriodResolver();
    // 열람 권한 판정은 StatViewPolicy 로 위임(StatViewPolicyTest 에서 단위 검증). 여기선 미사용 mock.
    @Mock
    private StatViewPolicy statViewPolicy;

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
                .totalFocusSeconds(120 * 60).sessionCount(2)
                .isFocusTimeGoalAchieved(true)
                .build();
        DailyScreenTimeStat screenMid = DailyScreenTimeStat.builder()
                .user(user).date(LocalDate.of(2026, 6, 2))
                .totalScreenTimeMinutes(30).isScreenTimeGoalAchieved(false)
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
                .user(user).streakCount(5).longestStreakCount(10).lastSessionDate(LocalDate.of(2026, 6, 28))
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
                        .totalFocusSeconds(45 * 60).isFocusTimeGoalAchieved(true).build()));
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.of(DailyScreenTimeStat.builder()
                        .totalScreenTimeMinutes(80).isScreenTimeGoalAchieved(false).build()));
        given(userFocusTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserFocusTimeSettings.builder()
                        .userId(USER_ID).dailyFocusTimeGoalMinutes(60).build()));
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build()));

        TodayStatsResponse response = statsService.getTodayStats(USER_ID, LocalDate.of(2026, 7, 3));

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

        TodayStatsResponse response = statsService.getTodayStats(USER_ID, LocalDate.of(2026, 7, 3));

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
                        .totalScreenTimeMinutes(150).isScreenTimeGoalAchieved(false).build()));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build()));

        TodayStatsResponse response = statsService.getTodayStats(USER_ID, LocalDate.of(2026, 7, 3));

        assertThat(response.screenTime().progressPercent()).isEqualTo(125); // round(150/120*100)
        assertThat(response.screenTime().goalAchieved()).isFalse();         // 150 > 120 → 미달성
    }

    @Test
    @DisplayName("오늘 요약 — 클라가 전달한 로컬 날짜로 집계 조회 (GROMO-643)")
    void getTodayStatsResolvesDateByClientDate() {
        User user = User.builder().id(USER_ID).build();
        LocalDate clientDate = LocalDate.of(2026, 7, 3);
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        statsService.getTodayStats(USER_ID, clientDate);

        ArgumentCaptor<LocalDate> dateCaptor = ArgumentCaptor.forClass(LocalDate.class);
        verify(dailyFocusStatRepository).findByUserAndDate(eq(user), dateCaptor.capture());
        assertThat(dateCaptor.getValue()).isEqualTo(clientDate);
    }

    @Test
    @DisplayName("오늘 요약 — 유저 없음 → UserException")
    void getTodayStatsUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> statsService.getTodayStats(USER_ID, LocalDate.of(2026, 7, 3)))
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
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(5400);
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(3600);

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

        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, thisMonday, FIXED_TODAY)).willReturn(12000);
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, prevMonday, prevFriday)).willReturn(9000);

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

        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, thisMonthStart, FIXED_TODAY)).willReturn(7200);
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, prevMonthStart, prevMonthSameDay)).willReturn(6000);

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
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(0);
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(2700);

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
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
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
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, marchStart, march31)).willReturn(18000);
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                user, febStart, feb28)).willReturn(12000);

        FocusPeriodStatsResponse response = statsService.getFocusStatsByPeriod(USER_ID, StatsPeriod.MONTH, march31);

        assertThat(response.from()).isEqualTo(marchStart);
        assertThat(response.to()).isEqualTo(march31);
        assertThat(response.totalFocusMinutes()).isEqualTo(300);
        assertThat(response.previousTotalFocusMinutes()).isEqualTo(200);
        assertThat(response.deltaMinutes()).isEqualTo(100);
    }

    @Test
    @DisplayName("기간별 통계 WEEK — sumTotalFocusSecondsByUserAndDateBetween 2회 호출 시 from/to 구간 정확")
    void getFocusStatsByPeriodWeekCallsRepositoryWithCorrectBounds() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserAndDateBetween(
                any(), any(), any())).willReturn(0);

        statsService.getFocusStatsByPeriod(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        ArgumentCaptor<LocalDate> fromCaptor = ArgumentCaptor.forClass(LocalDate.class);
        ArgumentCaptor<LocalDate> toCaptor = ArgumentCaptor.forClass(LocalDate.class);
        // 2회 호출 검증
        verify(dailyFocusStatRepository, times(2))
                .sumTotalFocusSecondsByUserAndDateBetween(eq(user), fromCaptor.capture(), toCaptor.capture());

        // 첫 번째 호출: current 구간 (이번 주 월요일~오늘). 2026-07-03은 금요일 → 월요일=2026-06-29
        assertThat(fromCaptor.getAllValues().get(0)).isEqualTo(LocalDate.of(2026, 6, 29));
        assertThat(toCaptor.getAllValues().get(0)).isEqualTo(FIXED_TODAY);
        // 두 번째 호출: previous 구간 (전주 월요일~전주 동일 요일)
        assertThat(fromCaptor.getAllValues().get(1)).isEqualTo(LocalDate.of(2026, 6, 22));
        assertThat(toCaptor.getAllValues().get(1)).isEqualTo(LocalDate.of(2026, 6, 26));
    }

    // ── getScreenTimePeriodStats ──────────────────────────────────────────

    @Test
    @DisplayName("스크린타임 DAY — 오늘/어제 row 있음 → currentMinutes·previousMinutes·deltaMinutes 정확, goalAchieved=true")
    void getScreenTimePeriodStatsDayNormal() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        DailyScreenTimeStat todayRow = DailyScreenTimeStat.builder()
                .user(user).date(FIXED_TODAY)
                .totalScreenTimeMinutes(80).isScreenTimeGoalAchieved(true).build();
        DailyScreenTimeStat yesterdayRow = DailyScreenTimeStat.builder()
                .user(user).date(FIXED_TODAY.minusDays(1))
                .totalScreenTimeMinutes(100).isScreenTimeGoalAchieved(false).build();

        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(List.of(todayRow));
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(List.of(yesterdayRow));
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build()));

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.period()).isEqualTo(StatsPeriod.DAY);
        assertThat(response.from()).isEqualTo(FIXED_TODAY);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        assertThat(response.currentMinutes()).isEqualTo(80);
        assertThat(response.previousMinutes()).isEqualTo(100);
        assertThat(response.deltaMinutes()).isEqualTo(-20);
        assertThat(response.goalMinutes()).isEqualTo(120);
        assertThat(response.goalAchieved()).isTrue();   // 80 <= 120 → 달성
        assertThat(response.achievedDays()).isNull();
        assertThat(response.elapsedDays()).isNull();
    }

    @Test
    @DisplayName("스크린타임 DAY — 오늘 row 없음 + 목표 미설정 → currentMinutes=0, goalAchieved=false")
    void getScreenTimePeriodStatsDayNoTodayRow() {
        // 데이터 row가 없고 목표도 미설정(goalMinutes=0)인 경우:
        // goalMinutes > 0 조건이 false → goalAchieved=false
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(List.of());
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(List.of());
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.currentMinutes()).isZero();
        assertThat(response.goalMinutes()).isZero();
        assertThat(response.goalAchieved()).isFalse();   // goalMinutes=0 → false
    }

    @Test
    @DisplayName("스크린타임 DAY — 오늘 row 없음 + 목표 설정(goalMinutes=60) → currentMinutes=0, goalAchieved=true")
    void getScreenTimePeriodStatsDayNoTodayRowWithGoal() {
        // 오늘 사용 기록 없음(0분) + 목표 설정됨 → 0 ≤ goalMinutes → goalAchieved=true
        // 스크린타임은 적을수록 좋으므로 기록이 없으면 목표 이내로 간주한다.
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(List.of());
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(List.of());
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(60).build()));

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.currentMinutes()).isZero();
        assertThat(response.goalMinutes()).isEqualTo(60);
        assertThat(response.goalAchieved()).isTrue();   // 0 <= 60 → 달성
    }

    @Test
    @DisplayName("스크린타임 DAY — 목표 미설정(goalMinutes=0) → goalAchieved=false")
    void getScreenTimePeriodStatsDayNoGoal() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        DailyScreenTimeStat todayRow = DailyScreenTimeStat.builder()
                .user(user).date(FIXED_TODAY)
                .totalScreenTimeMinutes(50).isScreenTimeGoalAchieved(false).build();
        DailyScreenTimeStat yesterdayRow = DailyScreenTimeStat.builder()
                .user(user).date(FIXED_TODAY.minusDays(1))
                .totalScreenTimeMinutes(80).isScreenTimeGoalAchieved(false).build();

        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(List.of(todayRow));
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(List.of(yesterdayRow));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.goalMinutes()).isZero();
        assertThat(response.goalAchieved()).isFalse();   // 목표 미설정 → false
        assertThat(response.deltaMinutes()).isEqualTo(-30); // 50 - 80 = -30 (음수 = 개선)
    }

    @Test
    @DisplayName("스크린타임 WEEK — 현재주 복수 row → currentMinutes 합산, achievedDays·totalDays 정확")
    void getScreenTimePeriodStatsWeekMultipleRows() {
        // 2026-07-03은 금요일, 이번 주 월요일 = 2026-06-29
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        LocalDate prevMonday = LocalDate.of(2026, 6, 22);
        LocalDate prevFriday = LocalDate.of(2026, 6, 26);

        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // 현재주: 월(달성)·수(미달성)·금(달성) — 3일치, 달성 2개
        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 29))
                        .totalScreenTimeMinutes(60).isScreenTimeGoalAchieved(true).build(),
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 7, 1))
                        .totalScreenTimeMinutes(130).isScreenTimeGoalAchieved(false).build(),
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 7, 3))
                        .totalScreenTimeMinutes(80).isScreenTimeGoalAchieved(true).build()
        );
        // 전주: 2일치
        List<DailyScreenTimeStat> previousStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 22))
                        .totalScreenTimeMinutes(90).isScreenTimeGoalAchieved(false).build(),
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 25))
                        .totalScreenTimeMinutes(70).isScreenTimeGoalAchieved(true).build()
        );

        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, prevMonday, prevFriday)).willReturn(previousStats);
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(100).build()));

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        assertThat(response.period()).isEqualTo(StatsPeriod.WEEK);
        assertThat(response.from()).isEqualTo(thisMonday);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        assertThat(response.currentMinutes()).isEqualTo(270);   // 60+130+80
        assertThat(response.previousMinutes()).isEqualTo(160);  // 90+70
        assertThat(response.deltaMinutes()).isEqualTo(110);
        assertThat(response.goalAchieved()).isNull();           // week → null
        assertThat(response.achievedDays()).isEqualTo(2);       // 월·금 달성, 수 미달성
        assertThat(response.elapsedDays()).isEqualTo(5);        // 월~금 5일 (DAYS.between(Mon,Fri)+1)
    }

    @Test
    @DisplayName("스크린타임 WEEK — 전주 경계: previousFrom=currentFrom-1주, previousTo=today-1주")
    void getScreenTimePeriodStatsWeekPreviousBounds() {
        // 2026-07-03 기준: thisMonday=2026-06-29, prevMonday=2026-06-22, prevFriday=2026-06-26
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        LocalDate prevMonday = LocalDate.of(2026, 6, 22);
        LocalDate prevFriday = LocalDate.of(2026, 6, 26);

        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                any(), any(), any())).willReturn(List.of());
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        ArgumentCaptor<LocalDate> fromCaptor = ArgumentCaptor.forClass(LocalDate.class);
        ArgumentCaptor<LocalDate> toCaptor = ArgumentCaptor.forClass(LocalDate.class);
        verify(dailyScreenTimeStatRepository, times(2))
                .findByUserAndDateBetweenOrderByDateAsc(eq(user), fromCaptor.capture(), toCaptor.capture());

        // 첫 번째 호출: current (이번 주 월요일~오늘)
        assertThat(fromCaptor.getAllValues().get(0)).isEqualTo(thisMonday);
        assertThat(toCaptor.getAllValues().get(0)).isEqualTo(FIXED_TODAY);
        // 두 번째 호출: previous (전주 월요일~전주 같은 요일)
        assertThat(fromCaptor.getAllValues().get(1)).isEqualTo(prevMonday);
        assertThat(toCaptor.getAllValues().get(1)).isEqualTo(prevFriday);
    }

    @Test
    @DisplayName("스크린타임 MONTH — 이번달 1일~오늘 경계, totalDays=오늘 일수")
    void getScreenTimePeriodStatsMonthCurrentBounds() {
        // 2026-07-03 기준: currentFrom=2026-07-01, totalDays=3
        LocalDate monthStart = LocalDate.of(2026, 7, 1);
        LocalDate prevMonthStart = LocalDate.of(2026, 6, 1);
        LocalDate prevMonthSameDay = LocalDate.of(2026, 6, 3);

        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        DailyScreenTimeStat row1 = DailyScreenTimeStat.builder()
                .user(user).date(LocalDate.of(2026, 7, 1))
                .totalScreenTimeMinutes(90).isScreenTimeGoalAchieved(true).build();
        DailyScreenTimeStat row2 = DailyScreenTimeStat.builder()
                .user(user).date(LocalDate.of(2026, 7, 3))
                .totalScreenTimeMinutes(110).isScreenTimeGoalAchieved(false).build();

        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, monthStart, FIXED_TODAY)).willReturn(List.of(row1, row2));
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, prevMonthStart, prevMonthSameDay)).willReturn(List.of());
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.MONTH, FIXED_TODAY);

        assertThat(response.period()).isEqualTo(StatsPeriod.MONTH);
        assertThat(response.from()).isEqualTo(monthStart);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        assertThat(response.currentMinutes()).isEqualTo(200);   // 90+110
        assertThat(response.previousMinutes()).isZero();
        assertThat(response.elapsedDays()).isEqualTo(3);         // 1일~3일
        assertThat(response.achievedDays()).isEqualTo(1);       // row1만 달성
        assertThat(response.goalAchieved()).isNull();
    }

    @Test
    @DisplayName("스크린타임 MONTH — 직전월 경계: previousFrom=전월 1일, previousTo=전월 같은 날짜")
    void getScreenTimePeriodStatsMonthPreviousBounds() {
        LocalDate monthStart = LocalDate.of(2026, 7, 1);
        LocalDate prevMonthStart = LocalDate.of(2026, 6, 1);
        LocalDate prevMonthSameDay = LocalDate.of(2026, 6, 3);

        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                any(), any(), any())).willReturn(List.of());
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.MONTH, FIXED_TODAY);

        ArgumentCaptor<LocalDate> fromCaptor = ArgumentCaptor.forClass(LocalDate.class);
        ArgumentCaptor<LocalDate> toCaptor = ArgumentCaptor.forClass(LocalDate.class);
        verify(dailyScreenTimeStatRepository, times(2))
                .findByUserAndDateBetweenOrderByDateAsc(eq(user), fromCaptor.capture(), toCaptor.capture());

        assertThat(fromCaptor.getAllValues().get(0)).isEqualTo(monthStart);
        assertThat(toCaptor.getAllValues().get(0)).isEqualTo(FIXED_TODAY);
        assertThat(fromCaptor.getAllValues().get(1)).isEqualTo(prevMonthStart);
        assertThat(toCaptor.getAllValues().get(1)).isEqualTo(prevMonthSameDay);
    }

    @Test
    @DisplayName("스크린타임 WEEK/MONTH — 달성 row 0개 → achievedDays=0")
    void getScreenTimePeriodStatsWeekNoAchievedDays() {
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);

        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // 현재주 row: 모두 미달성
        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 29))
                        .totalScreenTimeMinutes(150).isScreenTimeGoalAchieved(false).build(),
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 7, 3))
                        .totalScreenTimeMinutes(200).isScreenTimeGoalAchieved(false).build()
        );

        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, LocalDate.of(2026, 6, 22), LocalDate.of(2026, 6, 26))).willReturn(List.of());
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        assertThat(response.achievedDays()).isZero();
    }

    @Test
    @DisplayName("스크린타임 — 유저 없음 → UserException(NOT_FOUND)")
    void getScreenTimePeriodStatsUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() ->
                statsService.getScreenTimePeriodStats(USER_ID, StatsPeriod.DAY, FIXED_TODAY))
                .isInstanceOf(UserException.class);
    }

    // ── getFocusStatsByCategory ───────────────────────────────────────────

    // 고정 UUID — 카테고리 테스트 전용
    private static final UUID TAG_A = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID TAG_B = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");

    /** FocusSession 빌더 헬퍼 — startedAt·endedAt·focusTag(user_focus_tags) 지정. */
    private FocusSession session(Instant start, Instant end, UserFocusTag tag) {
        return FocusSession.builder()
                .startedAt(start)
                .endedAt(end)
                .focusTag(tag)
                .build();
    }

    /** UserFocusTag 빌더 헬퍼 — id + name(defaultTag) + user. name 은 default_tags 를 감싼다. */
    private UserFocusTag userFocusTag(UUID id, String name, User user) {
        return UserFocusTag.builder()
                .id(id)
                .user(user)
                .defaultTag(DefaultTag.builder().name(name).build())
                .build();
    }

    /** 소프트딜리트된 UserFocusTag 헬퍼. */
    private UserFocusTag deletedUserFocusTag(UUID id, String name, User user, Instant deletedAt) {
        return UserFocusTag.builder()
                .id(id)
                .user(user)
                .defaultTag(DefaultTag.builder().name(name).build())
                .deletedAt(deletedAt)
                .build();
    }

    @Test
    @DisplayName("카테고리별 — 복수 태그 정상 케이스: 태그별 totalFocusMinutes 정확, 전체 합계 일치")
    void getFocusStatsByCategoryMultipleTags() {
        // given: tagA=60분(30+30), tagB=90분
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", user);
        UserFocusTag tagB = userFocusTag(TAG_B, "운동", user);

        Instant base = Instant.parse("2026-07-03T01:00:00Z");
        List<FocusSession> sessions = List.of(
                session(base, base.plusSeconds(1800), tagA),  // 30분
                session(base.plusSeconds(3600), base.plusSeconds(5400), tagA), // 30분
                session(base.plusSeconds(7200), base.plusSeconds(12600), tagB) // 90분
        );

        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsInPeriod(eq(user), any(), any()))
                .willReturn(sessions);

        // when
        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        // then
        assertThat(response.period()).isEqualTo(StatsPeriod.DAY);
        assertThat(response.totalFocusMinutes()).isEqualTo(150); // 60 + 90
        assertThat(response.items()).hasSize(2);
        // 내림차순 정렬: tagB(90) > tagA(60)
        assertThat(response.items().get(0).tagId()).isEqualTo(TAG_B);
        assertThat(response.items().get(0).tagName()).isEqualTo("운동");
        assertThat(response.items().get(0).totalFocusMinutes()).isEqualTo(90);
        assertThat(response.items().get(1).tagId()).isEqualTo(TAG_A);
        assertThat(response.items().get(1).tagName()).isEqualTo("공부");
        assertThat(response.items().get(1).totalFocusMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("카테고리별 — 태그 없는 세션(미분류) 포함: tagId=null 항목 존재, 분 합산 정확")
    void getFocusStatsByCategoryUntaggedSession() {
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", user);

        Instant base = Instant.parse("2026-07-03T02:00:00Z");
        List<FocusSession> sessions = List.of(
                session(base, base.plusSeconds(3600), tagA),   // tagA 60분
                session(base.plusSeconds(7200), base.plusSeconds(9000), null) // 미분류 30분
        );

        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsInPeriod(eq(user), any(), any()))
                .willReturn(sessions);

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.totalFocusMinutes()).isEqualTo(90);
        assertThat(response.items()).hasSize(2);
        // 내림차순: tagA(60) > 미분류(30)
        assertThat(response.items().get(0).tagId()).isEqualTo(TAG_A);
        assertThat(response.items().get(1).tagId()).isNull();
        assertThat(response.items().get(1).tagName()).isNull();
        assertThat(response.items().get(1).totalFocusMinutes()).isEqualTo(30);
    }

    @Test
    @DisplayName("카테고리별 — 소프트딜리트 태그 세션 → 미분류 버킷 합류")
    void getFocusStatsByCategorySoftDeletedTagGoesToUntagged() {
        User user = User.builder().id(USER_ID).build();
        // deletedAt 설정된 소프트딜리트 태그
        UserFocusTag deletedTag =
                deletedUserFocusTag(TAG_A, "삭제된태그", user, Instant.parse("2026-06-01T00:00:00Z"));
        UserFocusTag activeTag = userFocusTag(TAG_B, "활성태그", user);

        Instant base = Instant.parse("2026-07-03T03:00:00Z");
        List<FocusSession> sessions = List.of(
                session(base, base.plusSeconds(3600), deletedTag),  // 60분 → 미분류
                session(base.plusSeconds(7200), base.plusSeconds(9000), activeTag) // 30분 → tagB
        );

        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsInPeriod(eq(user), any(), any()))
                .willReturn(sessions);

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.totalFocusMinutes()).isEqualTo(90);
        assertThat(response.items()).hasSize(2);
        // 내림차순: 미분류(60) > tagB(30)
        assertThat(response.items().get(0).tagId()).isNull();
        assertThat(response.items().get(0).totalFocusMinutes()).isEqualTo(60);
        assertThat(response.items().get(1).tagId()).isEqualTo(TAG_B);
        assertThat(response.items().get(1).totalFocusMinutes()).isEqualTo(30);
    }

    @Test
    @DisplayName("카테고리별 — 빈 기간(세션 없음): items=[], totalFocusMinutes=0")
    void getFocusStatsByCategoryEmptyPeriod() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsInPeriod(eq(user), any(), any()))
                .willReturn(List.of());

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        assertThat(response.totalFocusMinutes()).isZero();
        assertThat(response.items()).isEmpty();
    }

    @Test
    @DisplayName("카테고리별 — 미분류 0분이면 items에서 제외")
    void getFocusStatsByCategoryUntaggedZeroMinutesExcluded() {
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", user);
        Instant base = Instant.parse("2026-07-03T04:00:00Z");
        List<FocusSession> sessions = List.of(
                session(base, base.plusSeconds(1800), tagA) // 태그 있는 세션만
        );

        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsInPeriod(eq(user), any(), any()))
                .willReturn(sessions);

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        // 미분류 항목 없음
        assertThat(response.items()).hasSize(1);
        assertThat(response.items().get(0).tagId()).isEqualTo(TAG_A);
    }

    @Test
    @DisplayName("카테고리별 items — totalFocusMinutes 내림차순 정렬 검증")
    void getFocusStatsByCategoryItemsSortedDesc() {
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", user);
        UserFocusTag tagB = userFocusTag(TAG_B, "운동", user);

        Instant base = Instant.parse("2026-07-03T05:00:00Z");
        // tagA=20분, tagB=120분, 미분류=45분 → 정렬: tagB(120) > 미분류(45) > tagA(20)
        List<FocusSession> sessions = List.of(
                session(base, base.plusSeconds(1200), tagA),          // 20분
                session(base.plusSeconds(3600), base.plusSeconds(10800), tagB), // 120분
                session(base.plusSeconds(14400), base.plusSeconds(17100), null) // 45분
        );

        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsInPeriod(eq(user), any(), any()))
                .willReturn(sessions);

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.items()).hasSize(3);
        assertThat(response.items().get(0).totalFocusMinutes()).isEqualTo(120); // tagB
        assertThat(response.items().get(1).totalFocusMinutes()).isEqualTo(45);  // 미분류
        assertThat(response.items().get(2).totalFocusMinutes()).isEqualTo(20);  // tagA
    }

    @Test
    @DisplayName("카테고리별 DAY — endedAt 윈도우 [today 00:00, today+1 00:00) UTC (GROMO-671)")
    void getFocusStatsByCategoryDayBounds() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsInPeriod(eq(user), any(), any()))
                .willReturn(List.of());

        statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        ArgumentCaptor<Instant> fromCaptor = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<Instant> toCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(focusSessionRepository).findCompletedSessionsInPeriod(eq(user), fromCaptor.capture(), toCaptor.capture());

        // GROMO-671(커밋3): local_date 제거 → endedAt(UTC) 반열림 윈도우. FIXED_TODAY=2026-07-03.
        assertThat(fromCaptor.getValue()).isEqualTo(Instant.parse("2026-07-03T00:00:00Z"));
        assertThat(toCaptor.getValue()).isEqualTo(Instant.parse("2026-07-04T00:00:00Z"));
    }

    @Test
    @DisplayName("카테고리별 WEEK — endedAt from=이번 주 월요일 00:00 UTC (GROMO-671)")
    void getFocusStatsByCategoryWeekBounds() {
        // FIXED_TODAY=2026-07-03(금요일) → 이번 주 월요일=2026-06-29
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsInPeriod(eq(user), any(), any()))
                .willReturn(List.of());

        statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        ArgumentCaptor<Instant> fromCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(focusSessionRepository).findCompletedSessionsInPeriod(eq(user), fromCaptor.capture(), any());

        assertThat(fromCaptor.getValue()).isEqualTo(Instant.parse("2026-06-29T00:00:00Z"));
    }

    @Test
    @DisplayName("카테고리별 MONTH — endedAt from=이번 달 1일 00:00 UTC (GROMO-671)")
    void getFocusStatsByCategoryMonthBounds() {
        // FIXED_TODAY=2026-07-03 → 이번 달 1일=2026-07-01
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsInPeriod(eq(user), any(), any()))
                .willReturn(List.of());

        statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.MONTH, FIXED_TODAY);

        ArgumentCaptor<Instant> fromCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(focusSessionRepository).findCompletedSessionsInPeriod(eq(user), fromCaptor.capture(), any());

        assertThat(fromCaptor.getValue()).isEqualTo(Instant.parse("2026-07-01T00:00:00Z"));
    }

    // 열람 권한 판정(resolveTargetUserId, 친구/PUBLIC)은 StatViewPolicy 로 분리(GROMO-779) —
    // 단위 검증은 StatViewPolicyTest 참고. StatsService 는 얇은 위임만 하므로 여기서 중복 검증하지 않는다.
}
