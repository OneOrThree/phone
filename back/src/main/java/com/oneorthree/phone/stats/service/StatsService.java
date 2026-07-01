package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.common.util.CountryZoneResolver;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
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

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
        // countryCode 로 "오늘"을 산정해야 하므로 프록시(getReferenceById)가 아니라 실제 로드 + 404 매핑
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        LocalDate today = LocalDate.now(CountryZoneResolver.resolve(user.getCountryCode()));

        Optional<DailyFocusStat> focusStat = dailyFocusStatRepository.findByUserAndDate(user, today);
        Optional<DailyScreenTimeStat> screenStat = dailyScreenTimeStatRepository.findByUserAndDate(user, today);
        int focusGoal = userFocusTimeSettingsRepository.findById(userId)
                .map(UserFocusTimeSettings::getDailyFocusTimeGoalMinutes).orElse(0);
        int screenGoal = userScreenTimeSettingsRepository.findById(userId)
                .map(UserScreenTimeSettings::getDailyScreenTimeGoalMinutes).orElse(0);

        int focusMinutes = focusStat.map(DailyFocusStat::getTotalFocusMinutes).orElse(0);
        int screenMinutes = screenStat.map(DailyScreenTimeStat::getActualScreenTimeMinutes).orElse(0);

        return new TodayStatsResponse(
                new TodayStatsResponse.FocusStat(
                        focusMinutes,
                        focusGoal,
                        focusStat.map(DailyFocusStat::isFocusGoalAchieved).orElse(false),
                        progressPercent(focusMinutes, focusGoal)),
                new TodayStatsResponse.ScreenTimeStat(
                        screenMinutes,
                        screenGoal,
                        screenStat.map(DailyScreenTimeStat::isScreenTimeGoalAchieved).orElse(false),
                        progressPercent(screenMinutes, screenGoal)));
    }

    // 목표 대비 진행도(%). 목표 미설정(0)은 0%, 초과 시 100 초과 그대로 노출(클램프 없음).
    private int progressPercent(int actual, int goal) {
        return goal > 0 ? (int) Math.round((double) actual / goal * 100) : 0;
    }
}
