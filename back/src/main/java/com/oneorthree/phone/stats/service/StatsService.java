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
import com.oneorthree.phone.stats.exception.StatsErrorCode;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class StatsService {

    private static final long MAX_RANGE_DAYS = 366;

    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    private final UserStreakRepository userStreakRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final UserRepository userRepository;

    public List<HeatmapCellResponse> getHeatmap(UUID userId, LocalDate from, LocalDate to) {
        if (from == null || to == null || from.isAfter(to)
                || ChronoUnit.DAYS.between(from, to) + 1 > MAX_RANGE_DAYS) {
            throw new StatsException(StatsErrorCode.INVALID_DATE_RANGE);
        }

        User user = userRepository.getReferenceById(userId);
        // 집중 집계와 스크린타임 집계는 별도 테이블 → 각각 조회 후 날짜로 머지 (HeatmapCellResponse 시그니처는 불변)
        Map<LocalDate, DailyFocusStat> focusByDate = dailyFocusStatRepository
                .findByUserAndDateBetweenOrderByDateAsc(user, from, to).stream()
                .collect(Collectors.toMap(DailyFocusStat::getDate, Function.identity()));
        Map<LocalDate, DailyScreenTimeStat> screenByDate = dailyScreenTimeStatRepository
                .findByUserAndDateBetweenOrderByDateAsc(user, from, to).stream()
                .collect(Collectors.toMap(DailyScreenTimeStat::getDate, Function.identity()));

        List<HeatmapCellResponse> cells = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            DailyFocusStat f = focusByDate.get(d);
            DailyScreenTimeStat s = screenByDate.get(d);
            cells.add(new HeatmapCellResponse(
                    d,
                    f != null ? f.getTotalFocusMinutes() : 0,
                    f != null ? f.getSessionCount() : 0,
                    f != null && f.isFocusGoalAchieved(),
                    s != null ? s.getActualScreenTimeMinutes() : 0,
                    s != null && s.isScreenTimeGoalAchieved()));
        }
        return cells;
    }

    public StreakResponse getStreak(UUID userId) {
        User user = userRepository.getReferenceById(userId);
        return userStreakRepository.findByUser(user)
                .map(s -> new StreakResponse(s.getStreakCount(), s.getLongestStreak(), s.getLastSessionDate()))
                .orElseGet(() -> new StreakResponse(0, 0, null));
    }

    /**
     * 오늘의 집중·스크린타임 요약을 통합 반환한다.
     * "오늘"은 유저 country_code 파생 ZoneId 기준 로컬 날짜(미지원·null 은 UTC 폴백).
     * 집계·목표 row 가 없으면 각 값은 0/false, 진행도 0.
     */
    public TodayStatsResponse getTodayStats(UUID userId) {
        // 서버 데이터는 UTC 기준 저장 → "오늘"도 UTC로 산정(friend/group 조회와 동일 기준). 로컬 변환은 클라 담당.
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        LocalDate today = LocalDate.now(ZoneOffset.UTC);

        int focusMinutes = dailyFocusStatRepository.findByUserAndDate(user, today)
                .map(DailyFocusStat::getTotalFocusMinutes).orElse(0);
        int screenMinutes = dailyScreenTimeStatRepository.findByUserAndDate(user, today)
                .map(DailyScreenTimeStat::getActualScreenTimeMinutes).orElse(0);
        int focusGoal = userFocusTimeSettingsRepository.findById(userId)
                .map(UserFocusTimeSettings::getDailyFocusTimeGoalMinutes).orElse(0);
        int screenGoal = userScreenTimeSettingsRepository.findById(userId)
                .map(UserScreenTimeSettings::getDailyScreenTimeGoalMinutes).orElse(0);

        return new TodayStatsResponse(
                new TodayStatsResponse.FocusStat(
                        focusMinutes,
                        focusGoal,
                        focusGoal > 0 && focusMinutes >= focusGoal,     // 집중: 분 이상 — 현재 목표로 재계산
                        progressPercent(focusMinutes, focusGoal)),
                new TodayStatsResponse.ScreenTimeStat(
                        screenMinutes,
                        screenGoal,
                        screenGoal > 0 && screenMinutes <= screenGoal,  // 스크린타임: 분 이내 — 현재 목표로 재계산
                        progressPercent(screenMinutes, screenGoal)));
    }

    /**
     * 기간별 집중 시간 통계 조회 (실제 오늘 기준).
     * "오늘"은 UTC 고정 산정. 직전 동일 길이 구간과의 delta를 함께 반환한다.
     */
    public FocusPeriodStatsResponse getFocusStatsByPeriod(UUID userId, StatsPeriod period) {
        return getFocusStatsByPeriod(userId, period, LocalDate.now(ZoneOffset.UTC));
    }

    /**
     * 기간별 집중 시간 통계 조회 — 고정 시각 주입 오버로드 (테스트용, package-private).
     *
     * @param userId 사용자 UUID
     * @param period 조회 기간 단위 (DAY | WEEK | MONTH)
     * @param today  기준 날짜 (UTC)
     */
    FocusPeriodStatsResponse getFocusStatsByPeriod(UUID userId, StatsPeriod period, LocalDate today) {
        User user = userRepository.getReferenceById(userId);

        LocalDate currentFrom = switch (period) {
            case DAY -> today;
            case WEEK -> today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case MONTH -> today.withDayOfMonth(1);
        };

        // 직전 동일 길이 구간: currentFrom~today 와 동일한 날수를 직전에 배치
        LocalDate previousFrom = switch (period) {
            case DAY -> today.minusDays(1);
            case WEEK -> currentFrom.minusWeeks(1);
            case MONTH -> today.minusMonths(1).withDayOfMonth(1);
        };

        LocalDate previousTo = switch (period) {
            case DAY -> today.minusDays(1);
            case WEEK -> today.minusWeeks(1);
            // 전월 같은 날(말일 초과 시 Java가 자동으로 전월 말일로 조정)
            case MONTH -> today.minusMonths(1);
        };

        int current = dailyFocusStatRepository
                .sumTotalFocusMinutesByUserAndDateBetween(user, currentFrom, today);
        int previous = dailyFocusStatRepository
                .sumTotalFocusMinutesByUserAndDateBetween(user, previousFrom, previousTo);

        return new FocusPeriodStatsResponse(period, currentFrom, today, current, previous, current - previous);
    }

    // 목표 대비 진행도(%). 목표 미설정(0)은 0%, 초과 시 100 초과 그대로 노출(클램프 없음).
    private int progressPercent(int actual, int goal) {
        return goal > 0 ? (int) Math.round((double) actual / goal * 100) : 0;
    }
}
