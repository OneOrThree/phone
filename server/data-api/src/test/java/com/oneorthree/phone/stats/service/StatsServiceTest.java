package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.focus.repository.domain.DefaultTag;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.UserFocusTag;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.focus.repository.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.screentime.repository.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.dto.CategoryFocusStatsResponse;
import com.oneorthree.phone.focus.repository.FocusAverageAggregate;
import com.oneorthree.phone.stats.dto.FocusAverageResponse;
import com.oneorthree.phone.stats.dto.FocusAverageScope;
import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.ScreenTimePeriodStatsResponse;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.focus.repository.domain.UserStreak;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.focus.repository.UserStreakRepository;
import com.oneorthree.phone.stats.support.StatsPeriodResolver;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.argThat;
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
    private UserRepository userRepository;
    @Mock
    private UserQueryService userQueryService;
    @Mock
    private FriendshipRepository friendshipRepository;
    // 기간 경계 계산은 무상태 실로직을 그대로 검증한다(@Spy) — 추출 후에도 경계 assertion 동일하게 유지.
    @Spy
    private StatsPeriodResolver statsPeriodResolver = new StatsPeriodResolver();
    // 열람 권한 판정은 StatViewPolicy 로 위임(StatViewPolicyTest 에서 단위 검증). 여기선 미사용 mock.
    @Mock
    private StatViewPolicy statViewPolicy;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // GROMO-805: 스크린타임 목표(분) 스텁 — week/month 누락일 달성 판정용.
    private void givenScreenTimeGoal(int goalMinutes) {
        given(userQueryService.findScreenTimeSettings(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(goalMinutes).build()));
    }

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

    // ── getStreak (GROMO-847: read-time lazy 만료) ────────────────────────

    // 고정 조회 기준일 — 클라 로컬 "오늘"
    private static final LocalDate STREAK_TODAY = LocalDate.of(2026, 7, 16);

    @Test
    @DisplayName("스트릭 — lastSessionDate == 오늘 → currentStreak 유지")
    void getStreakKeepsWhenLastSessionToday() {
        User user = User.builder().id(USER_ID).build();
        UserStreak streak = UserStreak.builder()
                .user(user).streakCount(5).longestStreakCount(10).lastSessionDate(STREAK_TODAY)
                .build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(userStreakRepository.findByUser(user)).willReturn(Optional.of(streak));

        StreakResponse response = statsService.getStreak(USER_ID, STREAK_TODAY);

        assertThat(response.currentStreak()).isEqualTo(5);
        assertThat(response.longestStreak()).isEqualTo(10);
        assertThat(response.lastSessionDate()).isEqualTo(STREAK_TODAY);
    }

    @Test
    @DisplayName("스트릭 — lastSessionDate == 어제 → currentStreak 유지(오늘 아직 집중 전)")
    void getStreakKeepsWhenLastSessionYesterday() {
        User user = User.builder().id(USER_ID).build();
        UserStreak streak = UserStreak.builder()
                .user(user).streakCount(5).longestStreakCount(10)
                .lastSessionDate(STREAK_TODAY.minusDays(1))
                .build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(userStreakRepository.findByUser(user)).willReturn(Optional.of(streak));

        StreakResponse response = statsService.getStreak(USER_ID, STREAK_TODAY);

        assertThat(response.currentStreak()).isEqualTo(5);
    }

    @Test
    @DisplayName("스트릭 — lastSessionDate <= 그저께(공백) → currentStreak 0 리셋, longest·lastDate 원본 유지 (핵심 회귀)")
    void getStreakResetsWhenLastSessionBeforeYesterday() {
        // GROMO-847 재현: streakCount=5, lastSessionDate=6/28 유저가 공백 후 7/16 조회 → 끊겨야 정상.
        User user = User.builder().id(USER_ID).build();
        LocalDate lastSession = LocalDate.of(2026, 6, 28);
        UserStreak streak = UserStreak.builder()
                .user(user).streakCount(5).longestStreakCount(10).lastSessionDate(lastSession)
                .build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(userStreakRepository.findByUser(user)).willReturn(Optional.of(streak));

        StreakResponse response = statsService.getStreak(USER_ID, STREAK_TODAY);

        assertThat(response.currentStreak()).isZero();                  // 공백으로 끊김 → 0
        assertThat(response.longestStreak()).isEqualTo(10);             // 최장 기록은 원본 유지
        assertThat(response.lastSessionDate()).isEqualTo(lastSession);  // 마지막 집중일도 원본 유지(히스토리)
    }

    @Test
    @DisplayName("스트릭 — 기록 없으면 0/0/null")
    void getStreakNoRow() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(userStreakRepository.findByUser(user)).willReturn(Optional.empty());

        StreakResponse response = statsService.getStreak(USER_ID, STREAK_TODAY);

        assertThat(response.currentStreak()).isZero();
        assertThat(response.longestStreak()).isZero();
        assertThat(response.lastSessionDate()).isNull();
    }

    // ── getTodayStats ─────────────────────────────────────────────────────

    @Test
    @DisplayName("오늘 요약 — 달성 여부는 저장 플래그가 아니라 현재 목표로 재계산")
    void getTodayStatsFull() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);
        // 저장 플래그는 일부러 반대로 세팅 → 재계산이 이를 덮어쓰는지 검증
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.of(DailyFocusStat.builder()
                        .totalFocusSeconds(45 * 60).isFocusTimeGoalAchieved(true).build()));
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.of(DailyScreenTimeStat.builder()
                        .totalScreenTimeMinutes(80).isScreenTimeGoalAchieved(false).build()));
        given(userQueryService.findFocusTimeSettings(USER_ID))
                .willReturn(Optional.of(UserFocusTimeSettings.builder()
                        .userId(USER_ID).dailyFocusTimeGoalMinutes(60).build()));
        given(userQueryService.findScreenTimeSettings(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build()));

        TodayStatsResponse response = statsService.getTodayStats(USER_ID, USER_ID, LocalDate.of(2026, 7, 3));

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
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(userQueryService.findFocusTimeSettings(USER_ID)).willReturn(Optional.empty());
        given(userQueryService.findScreenTimeSettings(USER_ID)).willReturn(Optional.empty());

        TodayStatsResponse response = statsService.getTodayStats(USER_ID, USER_ID, LocalDate.of(2026, 7, 3));

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
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.of(DailyScreenTimeStat.builder()
                        .totalScreenTimeMinutes(150).isScreenTimeGoalAchieved(false).build()));
        given(userQueryService.findFocusTimeSettings(USER_ID)).willReturn(Optional.empty());
        given(userQueryService.findScreenTimeSettings(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build()));

        TodayStatsResponse response = statsService.getTodayStats(USER_ID, USER_ID, LocalDate.of(2026, 7, 3));

        assertThat(response.screenTime().progressPercent()).isEqualTo(125); // round(150/120*100)
        assertThat(response.screenTime().goalAchieved()).isFalse();         // 150 > 120 → 미달성
    }

    @Test
    @DisplayName("오늘 요약 — 클라가 전달한 로컬 날짜로 집계 조회 (GROMO-643)")
    void getTodayStatsResolvesDateByClientDate() {
        User user = User.builder().id(USER_ID).build();
        LocalDate clientDate = LocalDate.of(2026, 7, 3);
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);
        given(dailyFocusStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(dailyScreenTimeStatRepository.findByUserAndDate(eq(user), any(LocalDate.class)))
                .willReturn(Optional.empty());
        given(userQueryService.findFocusTimeSettings(USER_ID)).willReturn(Optional.empty());
        given(userQueryService.findScreenTimeSettings(USER_ID)).willReturn(Optional.empty());

        statsService.getTodayStats(USER_ID, USER_ID, clientDate);

        ArgumentCaptor<LocalDate> dateCaptor = ArgumentCaptor.forClass(LocalDate.class);
        verify(dailyFocusStatRepository).findByUserAndDate(eq(user), dateCaptor.capture());
        assertThat(dateCaptor.getValue()).isEqualTo(clientDate);
    }

    @Test
    @DisplayName("오늘 요약 — 유저 없음 → UserException")
    void getTodayStatsUserNotFound() {
        given(userQueryService.getTargetOf(any(), eq(USER_ID)))
                .willThrow(new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));

        assertThatThrownBy(() -> statsService.getTodayStats(USER_ID, USER_ID, LocalDate.of(2026, 7, 3)))
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
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

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
        given(userQueryService.findScreenTimeSettings(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build()));

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.DAY, FIXED_TODAY);

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
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(List.of());
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(List.of());
        given(userQueryService.findScreenTimeSettings(USER_ID)).willReturn(Optional.empty());

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.DAY, FIXED_TODAY);

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
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(List.of());
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(List.of());
        given(userQueryService.findScreenTimeSettings(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(60).build()));

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.currentMinutes()).isZero();
        assertThat(response.goalMinutes()).isEqualTo(60);
        assertThat(response.goalAchieved()).isTrue();   // 0 <= 60 → 달성
    }

    @Test
    @DisplayName("스크린타임 DAY — 목표 미설정(goalMinutes=0) → goalAchieved=false")
    void getScreenTimePeriodStatsDayNoGoal() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

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
        given(userQueryService.findScreenTimeSettings(USER_ID)).willReturn(Optional.empty());

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.goalMinutes()).isZero();
        assertThat(response.goalAchieved()).isFalse();   // 목표 미설정 → false
        assertThat(response.deltaMinutes()).isEqualTo(-30); // 50 - 80 = -30 (음수 = 개선)
    }

    @Test
    @DisplayName("스크린타임 WEEK(목표설정) — 누락일 달성 카운트: achievedDays = elapsed − failed, day 뷰와 의미 일치")
    void getScreenTimePeriodStatsWeekMultipleRows() {
        // 2026-07-03은 금요일, 이번 주 월요일 = 2026-06-29
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        LocalDate prevMonday = LocalDate.of(2026, 6, 22);
        LocalDate prevFriday = LocalDate.of(2026, 6, 26);

        // createdAt null → 가입 클램프 없음(clampedFrom = thisMonday)
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

        // 현재주: 월(달성 60)·수(미달성 130>100)·금(=오늘, 80분 interim flag=false) — row 3개, 화·목은 row 없음(=0분=달성).
        // GROMO-805 Fix 1: 오늘(07-03) row 의 저장 flag(interim=false)는 무시하고 80≤100 재계산 → 달성으로 센다.
        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 29))
                        .totalScreenTimeMinutes(60).isScreenTimeGoalAchieved(true).build(),
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 7, 1))
                        .totalScreenTimeMinutes(130).isScreenTimeGoalAchieved(false).build(),
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 7, 3))
                        .totalScreenTimeMinutes(80).isScreenTimeGoalAchieved(false).build()
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
        given(userQueryService.findScreenTimeSettings(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder()
                        .userId(USER_ID).dailyScreenTimeGoalMinutes(100).build()));

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        assertThat(response.period()).isEqualTo(StatsPeriod.WEEK);
        assertThat(response.from()).isEqualTo(thisMonday);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        assertThat(response.currentMinutes()).isEqualTo(270);   // 60+130+80
        assertThat(response.previousMinutes()).isEqualTo(160);  // 90+70
        assertThat(response.deltaMinutes()).isEqualTo(110);
        assertThat(response.goalAchieved()).isNull();           // week → null
        assertThat(response.elapsedDays()).isEqualTo(5);        // 월~금 5일
        // GROMO-805: row 없는 화·목 = 0분 = 달성. 과거 확정 실패=1(수 130>100). 오늘(금 80≤100 재계산)=달성.
        // achievedDays = 5 − (pastFailed 1 + todayFailed 0) = 4.
        assertThat(response.achievedDays()).isEqualTo(4);
    }

    @Test
    @DisplayName("스크린타임 WEEK — 전주 경계: previousFrom=currentFrom-1주, previousTo=today-1주")
    void getScreenTimePeriodStatsWeekPreviousBounds() {
        // 2026-07-03 기준: thisMonday=2026-06-29, prevMonday=2026-06-22, prevFriday=2026-06-26
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        LocalDate prevMonday = LocalDate.of(2026, 6, 22);
        LocalDate prevFriday = LocalDate.of(2026, 6, 26);

        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                any(), any(), any())).willReturn(List.of());
        given(userQueryService.findScreenTimeSettings(USER_ID)).willReturn(Optional.empty());

        statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

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
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

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
        given(userQueryService.findScreenTimeSettings(USER_ID)).willReturn(Optional.empty());

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.MONTH, FIXED_TODAY);

        assertThat(response.period()).isEqualTo(StatsPeriod.MONTH);
        assertThat(response.from()).isEqualTo(monthStart);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        assertThat(response.currentMinutes()).isEqualTo(200);   // 90+110
        assertThat(response.previousMinutes()).isZero();
        assertThat(response.elapsedDays()).isEqualTo(3);         // 1일~3일
        // GROMO-805: 목표 미설정(goal row 없음) → day 뷰와 동일하게 달성 판정 안 함 → 저장 플래그 카운트(row1만) = 1.
        assertThat(response.achievedDays()).isEqualTo(1);
        assertThat(response.goalAchieved()).isNull();
    }

    @Test
    @DisplayName("스크린타임 MONTH — 직전월 경계: previousFrom=전월 1일, previousTo=전월 같은 날짜")
    void getScreenTimePeriodStatsMonthPreviousBounds() {
        LocalDate monthStart = LocalDate.of(2026, 7, 1);
        LocalDate prevMonthStart = LocalDate.of(2026, 6, 1);
        LocalDate prevMonthSameDay = LocalDate.of(2026, 6, 3);

        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                any(), any(), any())).willReturn(List.of());
        given(userQueryService.findScreenTimeSettings(USER_ID)).willReturn(Optional.empty());

        statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.MONTH, FIXED_TODAY);

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
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

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
        given(userQueryService.findScreenTimeSettings(USER_ID)).willReturn(Optional.empty());

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        // 목표 미설정 → 저장 플래그(모두 false) 카운트 = 0.
        assertThat(response.achievedDays()).isZero();
    }

    @Test
    @DisplayName("스크린타임 WEEK(목표설정) — row 전혀 없음 → 모든 경과일이 달성(achievedDays == elapsedDays)")
    void getScreenTimePeriodStatsWeekAllMissingDaysAchievedWhenGoalSet() {
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        User user = User.builder().id(USER_ID).build();   // createdAt null → 클램프 없음
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(List.of());
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, LocalDate.of(2026, 6, 22), LocalDate.of(2026, 6, 26))).willReturn(List.of());
        givenScreenTimeGoal(120);

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        // row 없음 = 매일 0분 = 매일 달성. failedDays=0 → achievedDays = elapsedDays = 5.
        assertThat(response.elapsedDays()).isEqualTo(5);
        assertThat(response.achievedDays()).isEqualTo(5);
    }

    @Test
    @DisplayName("스크린타임 WEEK(목표설정) — 가입일 클램프: 가입 전 날은 경과·달성에서 제외")
    void getScreenTimePeriodStatsWeekClampsByJoinDate() {
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        // 가입 = 2026-07-01 KST(수요일) → clampedFrom = 07-01, clampedElapsed = 07-01..07-03 = 3일.
        User user = User.builder().id(USER_ID).countryCode("KR")
                .createdAt(Instant.parse("2026-06-30T15:30:00Z")).build();  // == 2026-07-01 00:30 KST
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);
        // 가입 후 금(07-03)만 미달성 row 1개, 목·화 등은 row 없음.
        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 7, 3))
                        .totalScreenTimeMinutes(200).isScreenTimeGoalAchieved(false).build()
        );
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, LocalDate.of(2026, 6, 22), LocalDate.of(2026, 6, 26))).willReturn(List.of());
        givenScreenTimeGoal(100);

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        // clampedElapsed = 07-01·07-02·07-03 = 3일. failedDays=1(금). achievedDays = 3 − 1 = 2(=07-01·07-02 누락일).
        assertThat(response.elapsedDays()).isEqualTo(3);
        assertThat(response.achievedDays()).isEqualTo(2);
    }

    @Test
    @DisplayName("스크린타임 WEEK(목표설정) — 가입 전 미달성 row 는 차감하지 않는다(achievedDays 정확·음수 방지)")
    void getScreenTimePeriodStatsWeekExcludesPreJoinFailedRow() {
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        // 가입 = 2026-07-01 KST(수요일) → clampedFrom = 07-01, clampedElapsed = 07-01..07-03 = 3일.
        User user = User.builder().id(USER_ID).countryCode("KR")
                .createdAt(Instant.parse("2026-06-30T15:30:00Z")).build();  // == 2026-07-01 00:30 KST
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);
        // 가입 전(06-29·06-30) 미달성 row 2개 — currentFrom..currentTo 조회엔 걸리지만 clampedFrom 이전이라
        // 경과일(clampedElapsed=3)에 속하지 않으므로 failedDays 차감 대상이 아니다. 가입 후 구간엔 row 없음(=매일 달성).
        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 29))
                        .totalScreenTimeMinutes(300).isScreenTimeGoalAchieved(false).build(),
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 30))
                        .totalScreenTimeMinutes(250).isScreenTimeGoalAchieved(false).build()
        );
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, LocalDate.of(2026, 6, 22), LocalDate.of(2026, 6, 26))).willReturn(List.of());
        givenScreenTimeGoal(100);

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        // clampedElapsed = 07-01·07-02·07-03 = 3일. 가입 전 2건은 차감 안 됨 → failedDays=0.
        // achievedDays = 3 − 0 = 3 (음수 아님), elapsedDays = 3.
        assertThat(response.elapsedDays()).isEqualTo(3);
        assertThat(response.achievedDays()).isEqualTo(3);
    }

    @Test
    @DisplayName("스크린타임 WEEK(목표설정) — 오늘 interim row(flag=false)라도 today≤goal 이면 달성으로 센다(day 뷰와 일치, Fix 1)")
    void getScreenTimePeriodStatsWeekTodayInterimRowUnderGoalCountsAchieved() {
        // 오늘(07-03) interim row: 저장 flag=false(마감 전이라 미확정)이지만 사용량 80 ≤ 목표 100.
        // day 뷰는 80≤100 을 달성으로 본다 → week 도 오늘을 저장 flag 가 아니라 재계산으로 판정해 동일해야 한다.
        // (구현 전이라면 저장 flag=false 를 그대로 실패로 세어 achievedDays 가 1 적게 나옴 → 회귀 방지 테스트)
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        User user = User.builder().id(USER_ID).build();   // createdAt null → 클램프 없음
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(FIXED_TODAY)
                        .totalScreenTimeMinutes(80).isScreenTimeGoalAchieved(false).build()
        );
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, LocalDate.of(2026, 6, 22), LocalDate.of(2026, 6, 26))).willReturn(List.of());
        givenScreenTimeGoal(100);

        // 교차검증: 같은 오늘 사용량으로 DAY 뷰를 조회하면 달성(goalAchieved=true)이어야 한다 → week 와 의미 일치.
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, FIXED_TODAY.minusDays(1), FIXED_TODAY.minusDays(1))).willReturn(List.of());

        ScreenTimePeriodStatsResponse week =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);
        ScreenTimePeriodStatsResponse day =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        // 월~금 5일, 오늘(금 80≤100)=달성, 나머지 4일 row 없음(=0분=달성) → 실패 0 → achievedDays=5.
        assertThat(week.elapsedDays()).isEqualTo(5);
        assertThat(week.achievedDays()).isEqualTo(5);
        // day 뷰도 오늘을 달성으로 본다 → week 의 오늘 기여와 정확히 일치.
        assertThat(day.goalAchieved()).isTrue();
    }

    @Test
    @DisplayName("스크린타임 WEEK(목표설정) — 오늘 interim row 가 today>goal 이면 오늘을 실패로 센다(day 뷰와 일치, Fix 1)")
    void getScreenTimePeriodStatsWeekTodayInterimRowOverGoalCountsFailed() {
        // 오늘(07-03) interim row: flag=false, 사용량 150 > 목표 100 → day 뷰는 미달성 → week 도 오늘을 실패로 센다.
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(FIXED_TODAY)
                        .totalScreenTimeMinutes(150).isScreenTimeGoalAchieved(false).build()
        );
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, LocalDate.of(2026, 6, 22), LocalDate.of(2026, 6, 26))).willReturn(List.of());
        givenScreenTimeGoal(100);

        ScreenTimePeriodStatsResponse week =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        // 월~금 5일, 오늘(금 150>100)=실패 1, 나머지 4일 row 없음=달성 → achievedDays = 5 − 1 = 4.
        assertThat(week.elapsedDays()).isEqualTo(5);
        assertThat(week.achievedDays()).isEqualTo(4);
    }

    @Test
    @DisplayName("스크린타임 WEEK(목표설정) — 오늘 final row 는 현재 목표 재계산 대신 저장 스냅샷으로 센다")
    void getScreenTimePeriodStatsWeekTodayFinalRowUsesStoredSnapshot() {
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(FIXED_TODAY)
                        .totalScreenTimeMinutes(80)
                        .isScreenTimeGoalAchieved(false)
                        .screenTimeFinalized(true)
                        .build()
        );
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, LocalDate.of(2026, 6, 22), LocalDate.of(2026, 6, 26))).willReturn(List.of());
        givenScreenTimeGoal(100);

        ScreenTimePeriodStatsResponse week =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        assertThat(week.elapsedDays()).isEqualTo(5);
        assertThat(week.achievedDays()).isEqualTo(4);
    }

    @Test
    @DisplayName("스크린타임 WEEK(목표미설정) — 저장 달성 row 도 가입일 이전이면 achievedDays 에서 제외")
    void getScreenTimePeriodStatsWeekNoGoalExcludesPreJoinAchievedRow() {
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        User user = User.builder().id(USER_ID).countryCode("KR")
                .createdAt(Instant.parse("2026-06-30T15:30:00Z")).build();
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 30))
                        .totalScreenTimeMinutes(50).isScreenTimeGoalAchieved(true).build(),
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 7, 2))
                        .totalScreenTimeMinutes(70).isScreenTimeGoalAchieved(false).build()
        );
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, LocalDate.of(2026, 6, 22), LocalDate.of(2026, 6, 26))).willReturn(List.of());
        given(userQueryService.findScreenTimeSettings(USER_ID)).willReturn(Optional.empty());

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        assertThat(response.elapsedDays()).isEqualTo(3);
        assertThat(response.achievedDays()).isZero();
    }

    @Test
    @DisplayName("스크린타임 WEEK — 가입 전 레거시 row 는 분 합계·delta 에서도 제외한다(Fix 2, day 클램프와 정합)")
    void getScreenTimePeriodStatsWeekExcludesPreJoinRowFromMinutes() {
        // 가입 = 2026-07-01 KST(수) → joinLocalDate=07-01. 가입 전(06-29·06-30) row 는 경과일(클램프)에서 빠지므로
        // 분 합계에서도 빠져야 day 카운트와 정합한다. previous 구간도 전부 가입 전이라 previousMinutes=0.
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        LocalDate prevMonday = LocalDate.of(2026, 6, 22);
        LocalDate prevFriday = LocalDate.of(2026, 6, 26);
        User user = User.builder().id(USER_ID).countryCode("KR")
                .createdAt(Instant.parse("2026-06-30T15:30:00Z")).build();  // == 2026-07-01 00:30 KST
        given(userQueryService.getTargetOf(any(), eq(USER_ID))).willReturn(user);

        // current: 가입 전 06-30(200, 제외) + 가입 후 07-02(50, 포함) → currentMinutes=50.
        List<DailyScreenTimeStat> currentStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 30))
                        .totalScreenTimeMinutes(200).isScreenTimeGoalAchieved(false).build(),
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 7, 2))
                        .totalScreenTimeMinutes(50).isScreenTimeGoalAchieved(true).build()
        );
        // previous: 전부 가입 전(06-24) → previousMinutes=0.
        List<DailyScreenTimeStat> previousStats = List.of(
                DailyScreenTimeStat.builder().user(user).date(LocalDate.of(2026, 6, 24))
                        .totalScreenTimeMinutes(300).isScreenTimeGoalAchieved(false).build()
        );
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, thisMonday, FIXED_TODAY)).willReturn(currentStats);
        given(dailyScreenTimeStatRepository.findByUserAndDateBetweenOrderByDateAsc(
                user, prevMonday, prevFriday)).willReturn(previousStats);
        givenScreenTimeGoal(100);

        ScreenTimePeriodStatsResponse response =
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        // 가입 전 06-30(200)·06-24(300) 은 분 합계에서 제외 → current=50(07-02), previous=0, delta=50.
        assertThat(response.currentMinutes()).isEqualTo(50);
        assertThat(response.previousMinutes()).isZero();
        assertThat(response.deltaMinutes()).isEqualTo(50);
    }

    @Test
    @DisplayName("스크린타임 — 유저 없음 → UserException(NOT_FOUND)")
    void getScreenTimePeriodStatsUserNotFound() {
        given(userQueryService.getTargetOf(any(), eq(USER_ID)))
                .willThrow(new UserException(UserErrorCode.TARGET_USER_NOT_FOUND));

        assertThatThrownBy(() ->
                statsService.getScreenTimePeriodStats(USER_ID, USER_ID, StatsPeriod.DAY, FIXED_TODAY))
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

    /** FocusSession 빌더 헬퍼 — 통계 귀속용 유효 종료(stat_end_at)까지 지정(GROMO-1252 ②). */
    private FocusSession session(Instant start, Instant end, Instant statEnd, UserFocusTag tag) {
        return FocusSession.builder()
                .startedAt(start)
                .endedAt(end)
                .statEndAt(statEnd)
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
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
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

    /**
     * 1214-⑥: by-category 도 방해 초를 뺀 순수 집중 시간을 센다.
     *
     * <p>⑤에서 사전집계({@code daily_focus_stats.total_focus_seconds})가 방해 초를 뺀 값이 되면서,
     * 원시 겹침 길이를 쓰던 by-category 는 일시정지가 낀 세션에서 총합보다 커졌다. 세션이 창에
     * 통째로 들어오면 기여분은 정확히 {@code 구간 − 방해초} — 사전집계가 저장하는 값과 같다.
     */
    @Test
    @DisplayName("1214-⑥: 일시정지가 낀 세션 → 과목별 합이 사전집계(구간−방해초)와 정확히 일치한다")
    void getFocusStatsByCategorySubtractsDistraction() {
        // 60분 세션 + 방해 15분 → 45분. 사전집계 recordCompletion 도 3600-900=2700초를 적립한다.
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", user);
        Instant base = Instant.parse("2026-07-03T01:00:00Z");
        FocusSession paused = session(base, base.plusSeconds(3600), tagA);
        // 분포 미기록(레거시 row) — 이 경로만 벽시계 gross 에서 방해 비율을 뺀다(1214 3차 ①).
        paused.end(base.plusSeconds(3600), 900, base.plusSeconds(3600), null);

        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
                .willReturn(List.of(paused));

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.totalFocusMinutes()).isEqualTo(45);
        assertThat(response.items().get(0).totalFocusMinutes()).isEqualTo(45);
    }

    @Test
    @DisplayName("1214-⑥: 창에 절반만 걸친 세션 → 방해 초도 겹침에 비례해서만 깎인다")
    void getFocusStatsByCategoryProratesDistractionToOverlap() {
        // 창(오늘 KST) 시작 전부터 이어진 세션 — 전체 60분 중 겹침 30분, 방해 12분(20%) → 30 × 0.8 = 24분.
        // 비율은 클리핑 전 세션 전체 길이 기준이다(방해 초에 타임스탬프가 없어 고르게 퍼졌다고 본다).
        User user = User.builder().id(USER_ID).build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", user);
        // FIXED_TODAY(KST) 자정 = 전날 15:00Z. 세션 14:30Z~15:30Z → 창 안 겹침은 뒤쪽 30분.
        Instant windowStart = FIXED_TODAY.atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant();
        FocusSession straddler = session(windowStart.minusSeconds(1800), windowStart.plusSeconds(1800), tagA);
        straddler.end(windowStart.plusSeconds(1800), 720, windowStart.plusSeconds(1800), null);

        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
                .willReturn(List.of(straddler));

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.totalFocusMinutes()).isEqualTo(24);
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
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
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
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
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
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
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
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
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
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
                .willReturn(sessions);

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.items()).hasSize(3);
        assertThat(response.items().get(0).totalFocusMinutes()).isEqualTo(120); // tagB
        assertThat(response.items().get(1).totalFocusMinutes()).isEqualTo(45);  // 미분류
        assertThat(response.items().get(2).totalFocusMinutes()).isEqualTo(20);  // tagA
    }

    /**
     * GROMO-1252(코드리뷰 P1): 자정을 걸친 세션은 창 겹침분만 계수해야 사전집계(DailyFocusStat 날짜별 분할)와
     * 같은 화면에서 총합·과목별 합이 맞는다. 종전엔 endedAt 이 창 안이면 세션 전체 길이를 종료일에 몰아 넣었다.
     */
    @Test
    @DisplayName("카테고리별 — 자정 걸친 세션은 창 겹침분만 계수(DailyFocusStat 날짜별 분할과 정합, GROMO-1252)")
    void getFocusStatsByCategoryClipsMidnightSpanningSession() {
        // KR 유저 DAY(2026-07-03) 창 = 07-02T15:00Z ~ 07-03T15:00Z (KST 자정).
        // 세션: 07-02 23:00 KST(14:00Z) ~ 07-03 10:00 KST(01:00Z) = 총 11h.
        // → 07-03 몫은 겹침분 10h 뿐(07-02 몫 1h 은 전날 집계). 종전 동작이면 11h 전부가 07-03 에 잡혔다.
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", krUser);
        List<FocusSession> sessions = List.of(session(
                Instant.parse("2026-07-02T14:00:00Z"), Instant.parse("2026-07-03T01:00:00Z"), tagA));

        given(userRepository.getReferenceById(USER_ID)).willReturn(krUser);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(krUser), any(), any()))
                .willReturn(sessions);

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.totalFocusMinutes()).isEqualTo(10 * 60);
        assertThat(response.items()).hasSize(1);
        assertThat(response.items().get(0).totalFocusMinutes()).isEqualTo(10 * 60);
    }

    /** GROMO-1252: 미래 endedAt 위조 세션은 창 상단이 now 로 클램프돼 실경과분만 잡힌다(사전집계와 동일 기준). */
    @Test
    @DisplayName("카테고리별 — 미래 endedAt 세션은 now 까지만 계수(오늘 창, GROMO-1252)")
    void getFocusStatsByCategoryClampsFutureEndedAtToNow() {
        ZoneId kst = ZoneId.of("Asia/Seoul");
        Instant now = Instant.now();
        LocalDate todayKst = now.atZone(kst).toLocalDate();
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", krUser);
        // 1시간 전에 시작해 5시간 뒤에 끝난다고 위조 → 인정될 몫은 (창 시작~now) 뿐. 클램프가 없으면 6시간(자정 클립).
        Instant startedAt = now.minusSeconds(3600);
        List<FocusSession> sessions = List.of(session(startedAt, now.plusSeconds(5 * 3600), tagA));

        given(userRepository.getReferenceById(USER_ID)).willReturn(krUser);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(krUser), any(), any()))
                .willReturn(sessions);

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, todayKst);

        // 기대치 = max(오늘 자정, startedAt) ~ now (자정 직후 실행 시 창 하단이 이긴다). ±1분은 실행 지연 여유.
        Instant dayStart = todayKst.atStartOfDay(kst).toInstant();
        long expected = Duration.between(startedAt.isAfter(dayStart) ? startedAt : dayStart, now).getSeconds() / 60;
        assertThat(response.totalFocusMinutes()).isBetween((int) expected, (int) expected + 1);
    }

    /**
     * GROMO-1252 코드리뷰 2차 ②: 미래 endedAt 세션은 조회 시점 now 가 아니라 <b>완료 시점에 고정된</b>
     * stat_end_at 까지만 계수해야 한다. now 로 자르면 시간이 갈수록 위조 구간을 더 세고(내일이면 전량),
     * 완료 시점에 고정되는 사전집계 DailyFocusStat 과 계속 벌어진다.
     */
    @Test
    @DisplayName("카테고리별 — 미래 endedAt 세션은 완료 시점 stat_end_at 에서 멈춘다(시간이 지나도 안 늘어남)")
    void getFocusStatsByCategoryUsesFrozenStatEndAt() {
        ZoneId kst = ZoneId.of("Asia/Seoul");
        Instant now = Instant.now();
        LocalDate todayKst = now.atZone(kst).toLocalDate();
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", krUser);
        // 3시간 전 시작 → 2시간 전에 완료(그때 클램프된 stat_end_at)인데 endedAt 은 5시간 뒤로 위조됐다.
        // 인정 몫은 1시간뿐 — endedAt 으로 자르면 (창 시작~now) 인 3시간이 잡히고 내일이면 더 커진다.
        Instant startedAt = now.minusSeconds(3 * 3600);
        Instant statEndAt = now.minusSeconds(2 * 3600);
        List<FocusSession> sessions =
                List.of(session(startedAt, now.plusSeconds(5 * 3600), statEndAt, tagA));

        given(userRepository.getReferenceById(USER_ID)).willReturn(krUser);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(krUser), any(), any()))
                .willReturn(sessions);

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, todayKst);

        // 창 하단(오늘 자정)이 startedAt 보다 늦을 수 있다(새벽 실행) — 그 경우만 몫이 줄어든다.
        Instant dayStart = todayKst.atStartOfDay(kst).toInstant();
        Instant sliceStart = startedAt.isAfter(dayStart) ? startedAt : dayStart;
        long expected = Math.max(0, Duration.between(sliceStart, statEndAt).getSeconds()) / 60;
        assertThat(response.totalFocusMinutes()).isEqualTo((int) expected);
    }

    /**
     * GROMO-1252 코드리뷰 3차 ①: 세션에 확정 분포(focus_seconds_by_date)가 있으면 by-category 도 그 값을 쓴다.
     * 일시정지가 자정을 걸친 세션(23:50~23:55 집중 → 일시정지 → 00:10~00:15 집중)은 사전집계가 300/300 인데
     * 벽시계 클리핑은 오늘 몫을 900 으로 세, 같은 화면의 총합(/stats/focus)과 과목별 합이 어긋났다.
     */
    @Test
    @DisplayName("카테고리별 — 저장된 확정 분포가 있으면 벽시계 클리핑 대신 그 분포로 계수(사전집계와 일치)")
    void getFocusStatsByCategoryUsesStoredSecondsByDate() {
        ZoneId kst = ZoneId.of("Asia/Seoul");
        LocalDate today = LocalDate.of(2026, 7, 13);
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", krUser);
        // 07-12 23:50 KST ~ 07-13 00:15 KST — 벽시계로는 오늘 몫 900초, 실제 집중은 300초.
        FocusSession stored = FocusSession.builder()
                .startedAt(LocalDate.of(2026, 7, 12).atTime(23, 50).atZone(kst).toInstant())
                .endedAt(today.atTime(0, 15).atZone(kst).toInstant())
                .focusTag(tagA)
                .focusSecondsByDate(Map.of("2026-07-12", 300, "2026-07-13", 300))
                .build();

        given(userRepository.getReferenceById(USER_ID)).willReturn(krUser);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(krUser), any(), any()))
                .willReturn(List.of(stored));

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, today);

        // 창(07-13) 밖인 07-12 몫은 빠지고 오늘 몫 300초 = 5분만 남는다(벽시계였다면 15분).
        assertThat(response.totalFocusMinutes()).isEqualTo(5);
        assertThat(response.items()).singleElement()
                .satisfies(item -> assertThat(item.totalFocusMinutes()).isEqualTo(5));
    }

    /**
     * GROMO-1214 코드리뷰 3차 ①: 저장된 확정 분포는 <b>이미 방해 초가 빠진 net</b> 이다
     * (FocusService.resolveSecondsByDate 가 경로별로 처리해 net 으로 통일해 저장한다).
     * 여기서 방해 비율을 또 빼면 이중 차감이라 사전집계(DailyFocusStat)보다 작아진다.
     */
    @Test
    @DisplayName("1214-①(3차): 저장된 분포 경로는 방해초를 다시 빼지 않는다 — 이미 net")
    void getFocusStatsByCategoryDoesNotSubtractDistractionFromStoredDistribution() {
        ZoneId kst = ZoneId.of("Asia/Seoul");
        LocalDate today = LocalDate.of(2026, 7, 13);
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        UserFocusTag tagA = userFocusTag(TAG_A, "공부", krUser);
        // 10:00~11:00 KST 벽시계 3600 중 절반이 일시정지 → 저장 분포는 net 1800.
        FocusSession stored = FocusSession.builder()
                .startedAt(today.atTime(10, 0).atZone(kst).toInstant())
                .endedAt(today.atTime(11, 0).atZone(kst).toInstant())
                .focusTag(tagA)
                .totalDistractionSeconds(1800)
                .focusSecondsByDate(Map.of("2026-07-13", 1800))
                .build();

        given(userRepository.getReferenceById(USER_ID)).willReturn(krUser);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(krUser), any(), any()))
                .willReturn(List.of(stored));

        CategoryFocusStatsResponse response =
                statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, today);

        // 이중 차감이면 1800 × (1 − 0.5) = 900초 = 15분이 된다.
        assertThat(response.totalFocusMinutes()).isEqualTo(30);
    }

    @Test
    @DisplayName("카테고리별 DAY(countryCode=null) — endedAt 윈도우가 폴백 존(Asia/Seoul) 자정 기준 (GROMO-803/1252)")
    void getFocusStatsByCategoryDayBounds() {
        // countryCode 없는 유저 → 폴백 존(Asia/Seoul, GROMO-1252). KR 유저와 같은 윈도우가 나온다.
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
                .willReturn(List.of());

        statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        ArgumentCaptor<Instant> fromCaptor = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<Instant> toCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(focusSessionRepository).findCompletedSessionsOverlappingPeriod(eq(user), fromCaptor.capture(), toCaptor.capture());

        // GROMO-803: endedAt 존 윈도우 — 유저 존 미지정이라 Asia/Seoul 폴백. FIXED_TODAY=2026-07-03
        // → KST 자정 = 2026-07-02T15:00Z ~ 2026-07-03T15:00Z (UTC 폴백이었다면 00:00Z ~ 00:00Z).
        assertThat(fromCaptor.getValue()).isEqualTo(Instant.parse("2026-07-02T15:00:00Z"));
        assertThat(toCaptor.getValue()).isEqualTo(Instant.parse("2026-07-03T15:00:00Z"));
    }

    @Test
    @DisplayName("카테고리별 DAY(KR 유저) — endedAt 윈도우가 KST 자정 기준으로 시프트 (GROMO-803, 일별 버킷과 정합)")
    void getFocusStatsByCategoryDayBoundsKstZone() {
        // KR 유저 → country_code 존(KST). today=2026-07-03 의 KST 자정 = 2026-07-02T15:00Z ~ 2026-07-03T15:00Z.
        // 일별 버킷(DailyFocusStat)이 KST 로컬 날짜가 됐으므로 by-category 윈도우도 같은 존으로 열려야 경계 세션이 정합.
        User krUser = User.builder().id(USER_ID).countryCode("KR").build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(krUser);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(krUser), any(), any()))
                .willReturn(List.of());

        statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.DAY, FIXED_TODAY);

        ArgumentCaptor<Instant> fromCaptor = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<Instant> toCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(focusSessionRepository)
                .findCompletedSessionsOverlappingPeriod(eq(krUser), fromCaptor.capture(), toCaptor.capture());

        // KST 자정 경계 — UTC(00:00Z)가 아니라 전날 15:00Z ~ 당일 15:00Z
        assertThat(fromCaptor.getValue()).isEqualTo(Instant.parse("2026-07-02T15:00:00Z"));
        assertThat(toCaptor.getValue()).isEqualTo(Instant.parse("2026-07-03T15:00:00Z"));
    }

    @Test
    @DisplayName("카테고리별 WEEK(countryCode=null) — endedAt from=이번 주 월요일 00:00 폴백 존(KST) (GROMO-803/1252)")
    void getFocusStatsByCategoryWeekBounds() {
        // FIXED_TODAY=2026-07-03(금요일) → 이번 주 월요일=2026-06-29. countryCode 없음 → Asia/Seoul 폴백.
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
                .willReturn(List.of());

        statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.WEEK, FIXED_TODAY);

        ArgumentCaptor<Instant> fromCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(focusSessionRepository).findCompletedSessionsOverlappingPeriod(eq(user), fromCaptor.capture(), any());

        // 06-29 00:00 KST = 06-28T15:00Z
        assertThat(fromCaptor.getValue()).isEqualTo(Instant.parse("2026-06-28T15:00:00Z"));
    }

    @Test
    @DisplayName("카테고리별 MONTH(countryCode=null) — endedAt from=이번 달 1일 00:00 폴백 존(KST) (GROMO-803/1252)")
    void getFocusStatsByCategoryMonthBounds() {
        // FIXED_TODAY=2026-07-03 → 이번 달 1일=2026-07-01. countryCode 없음 → Asia/Seoul 폴백.
        User user = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(user);
        given(focusSessionRepository.findCompletedSessionsOverlappingPeriod(eq(user), any(), any()))
                .willReturn(List.of());

        statsService.getFocusStatsByCategory(USER_ID, StatsPeriod.MONTH, FIXED_TODAY);

        ArgumentCaptor<Instant> fromCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(focusSessionRepository).findCompletedSessionsOverlappingPeriod(eq(user), fromCaptor.capture(), any());

        // 07-01 00:00 KST = 06-30T15:00Z
        assertThat(fromCaptor.getValue()).isEqualTo(Instant.parse("2026-06-30T15:00:00Z"));
    }

    // ── getFocusAverage (GROMO-753) ───────────────────────────────────────

    private static final UUID FRIEND_A = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID FRIEND_B = UUID.fromString("00000000-0000-0000-0000-0000000000a2");

    private Friendship acceptedWith(User caller, User other) {
        // caller 가 fromUser 인 방향으로 세팅 — counterpart 는 toUser(other) 를 반환.
        return Friendship.builder().fromUser(caller).toUser(other).build();
    }

    @Test
    @DisplayName("평균 FRIENDS DAY — 활동 친구 2명(90분+60분 합) → floor(9000/2/60)=75, sampleSize=2")
    void getFocusAverageFriendsDay() {
        User caller = User.builder().id(USER_ID).build();
        User friendA = User.builder().id(FRIEND_A).build();
        User friendB = User.builder().id(FRIEND_B).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(caller);
        given(friendshipRepository.findAcceptedByUser(caller))
                .willReturn(List.of(acceptedWith(caller, friendA), acceptedWith(caller, friendB)));
        // 90분(5400초) + 60분(3600초) = 9000초, 활동 유저 2명
        given(dailyFocusStatRepository.sumAndActiveCountByUsersInPeriod(
                anyCollection(), eq(FIXED_TODAY), eq(FIXED_TODAY)))
                .willReturn(new FocusAverageAggregate(9000L, 2L));

        FocusAverageResponse response =
                statsService.getFocusAverage(USER_ID, FocusAverageScope.FRIENDS, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.scope()).isEqualTo(FocusAverageScope.FRIENDS);
        assertThat(response.period()).isEqualTo(StatsPeriod.DAY);
        assertThat(response.from()).isEqualTo(FIXED_TODAY);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        assertThat(response.averageMinutes()).isEqualTo(75);
        assertThat(response.sampleSize()).isEqualTo(2);
    }

    @Test
    @DisplayName("평균 FRIENDS — 친구 집합에 상대 User 만 전달(caller 미포함)")
    void getFocusAverageFriendsExcludesCaller() {
        User caller = User.builder().id(USER_ID).build();
        User friendA = User.builder().id(FRIEND_A).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(caller);
        given(friendshipRepository.findAcceptedByUser(caller))
                .willReturn(List.of(acceptedWith(caller, friendA)));
        given(dailyFocusStatRepository.sumAndActiveCountByUsersInPeriod(anyCollection(), any(), any()))
                .willReturn(new FocusAverageAggregate(3600L, 1L));

        statsService.getFocusAverage(USER_ID, FocusAverageScope.FRIENDS, StatsPeriod.DAY, FIXED_TODAY);

        // 전달된 집합은 상대(friendA) 만 — caller 는 미포함
        verify(dailyFocusStatRepository).sumAndActiveCountByUsersInPeriod(
                argThat(users -> users.size() == 1 && users.contains(friendA) && !users.contains(caller)),
                eq(FIXED_TODAY), eq(FIXED_TODAY));
    }

    @Test
    @DisplayName("평균 FRIENDS — 친구 0명 → averageMinutes=null, sampleSize=0 (리포지토리 미호출)")
    void getFocusAverageFriendsEmptyReturnsNull() {
        User caller = User.builder().id(USER_ID).build();
        given(userRepository.getReferenceById(USER_ID)).willReturn(caller);
        given(friendshipRepository.findAcceptedByUser(caller)).willReturn(List.of());

        FocusAverageResponse response =
                statsService.getFocusAverage(USER_ID, FocusAverageScope.FRIENDS, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.averageMinutes()).isNull();
        assertThat(response.sampleSize()).isZero();
        verify(dailyFocusStatRepository, times(0))
                .sumAndActiveCountByUsersInPeriod(anyCollection(), any(), any());
    }

    @Test
    @DisplayName("평균 TOTAL WEEK — 활동 유저 3명(총 12000초) → floor(12000/3/60)=66, sampleSize=3, 주 경계 정확")
    void getFocusAverageTotalWeek() {
        // 2026-07-03(금) → 이번 주 월요일=2026-06-29
        LocalDate thisMonday = LocalDate.of(2026, 6, 29);
        given(dailyFocusStatRepository.sumAndActiveCountAllInPeriod(thisMonday, FIXED_TODAY))
                .willReturn(new FocusAverageAggregate(12000L, 3L));

        FocusAverageResponse response =
                statsService.getFocusAverage(USER_ID, FocusAverageScope.TOTAL, StatsPeriod.WEEK, FIXED_TODAY);

        assertThat(response.scope()).isEqualTo(FocusAverageScope.TOTAL);
        assertThat(response.from()).isEqualTo(thisMonday);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        // 12000 / 3 = 4000초 → 66분(4000/60=66.67 내림)
        assertThat(response.averageMinutes()).isEqualTo(66);
        assertThat(response.sampleSize()).isEqualTo(3);
    }

    @Test
    @DisplayName("평균 TOTAL — 활동 유저 0명(전원 휴면) → averageMinutes=null, sampleSize=0")
    void getFocusAverageTotalNoActiveReturnsNull() {
        given(dailyFocusStatRepository.sumAndActiveCountAllInPeriod(any(), any()))
                .willReturn(new FocusAverageAggregate(0L, 0L));

        FocusAverageResponse response =
                statsService.getFocusAverage(USER_ID, FocusAverageScope.TOTAL, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.averageMinutes()).isNull();
        assertThat(response.sampleSize()).isZero();
    }

    @Test
    @DisplayName("평균 CATEGORY MONTH — caller occupation=CODING, 활동 4명(총 24000초) → floor(24000/4/60)=100, 월 경계 정확")
    void getFocusAverageCategoryMonth() {
        // 2026-07-03 → 이번 달 1일=2026-07-01
        LocalDate thisMonthStart = LocalDate.of(2026, 7, 1);
        User caller = User.builder().id(USER_ID).occupation(Occupation.CODING).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(caller);
        given(dailyFocusStatRepository.sumAndActiveCountByOccupationInPeriod(
                Occupation.CODING, thisMonthStart, FIXED_TODAY))
                .willReturn(new FocusAverageAggregate(24000L, 4L));

        FocusAverageResponse response =
                statsService.getFocusAverage(USER_ID, FocusAverageScope.CATEGORY, StatsPeriod.MONTH, FIXED_TODAY);

        assertThat(response.scope()).isEqualTo(FocusAverageScope.CATEGORY);
        assertThat(response.from()).isEqualTo(thisMonthStart);
        assertThat(response.to()).isEqualTo(FIXED_TODAY);
        // 24000 / 4 = 6000초 → 100분
        assertThat(response.averageMinutes()).isEqualTo(100);
        assertThat(response.sampleSize()).isEqualTo(4);
    }

    @Test
    @DisplayName("평균 CATEGORY — occupation 미설정 → 400 아닌 averageMinutes=null, sampleSize=0 (리포지토리 미호출)")
    void getFocusAverageCategoryNullOccupationReturnsNull() {
        User caller = User.builder().id(USER_ID).build(); // occupation = null
        given(userQueryService.getCaller(USER_ID)).willReturn(caller);

        FocusAverageResponse response =
                statsService.getFocusAverage(USER_ID, FocusAverageScope.CATEGORY, StatsPeriod.DAY, FIXED_TODAY);

        assertThat(response.averageMinutes()).isNull();
        assertThat(response.sampleSize()).isZero();
        verify(dailyFocusStatRepository, times(0))
                .sumAndActiveCountByOccupationInPeriod(any(), any(), any());
    }

    @Test
    @DisplayName("평균 CATEGORY — caller 미존재·탈퇴 → USER_NOT_FOUND")
    void getFocusAverageCategoryCallerNotFound() {
        given(userQueryService.getCaller(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() ->
                statsService.getFocusAverage(USER_ID, FocusAverageScope.CATEGORY, StatsPeriod.DAY, FIXED_TODAY))
                .isInstanceOf(UserException.class);
    }

    @Test
    @DisplayName("평균 — 초 합/인원 나눗셈 후 분 내림(floor): 5900초/2명=2950초 → 49분(2950/60=49.17)")
    void getFocusAverageFloorsMinutes() {
        given(dailyFocusStatRepository.sumAndActiveCountAllInPeriod(any(), any()))
                .willReturn(new FocusAverageAggregate(5900L, 2L));

        FocusAverageResponse response =
                statsService.getFocusAverage(USER_ID, FocusAverageScope.TOTAL, StatsPeriod.DAY, FIXED_TODAY);

        // 5900 / 2 = 2950초 → 2950/60 = 49.17 → 49분(내림)
        assertThat(response.averageMinutes()).isEqualTo(49);
        assertThat(response.sampleSize()).isEqualTo(2);
    }

    // 열람 권한 판정(resolveTargetUserId, 친구/PUBLIC)은 StatViewPolicy 로 분리(GROMO-779) —
    // 단위 검증은 StatViewPolicyTest 참고. StatsService 는 얇은 위임만 하므로 여기서 중복 검증하지 않는다.
}
