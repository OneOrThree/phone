package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.focus.domain.DailyFocusStat;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.exception.StatsErrorCode;
import com.oneorthree.phone.stats.exception.StatsException;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserStreakRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
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
    private final UserStreakRepository userStreakRepository;
    private final UserRepository userRepository;

    public List<HeatmapCellResponse> getHeatmap(UUID userId, LocalDate from, LocalDate to) {
        if (from == null || to == null || from.isAfter(to)
                || ChronoUnit.DAYS.between(from, to) + 1 > MAX_RANGE_DAYS) {
            throw new StatsException(StatsErrorCode.INVALID_DATE_RANGE);
        }

        User user = userRepository.getReferenceById(userId);
        // TODO GROMO-551: 스크린타임 분리로 인해 screentime 집계를 별도 조회 후 날짜로 머지
        //   - DailyScreenTimeStatRepository 주입 (필드 추가)
        //   - Map<LocalDate, DailyScreenTimeStat> screenByDate = ...findByUserAndDateBetweenOrderByDateAsc(user, from, to)
        //   - 아래 셀 빌드에서 actualScreenTimeMinutes/screenTimeGoalAchieved 는 screenByDate 에서 가져오고
        //     (해당 날짜 없으면 0/false), focus 필드는 기존 byDate 에서 가져온다. HeatmapCellResponse 시그니처는 불변.
        Map<LocalDate, DailyFocusStat> byDate = dailyFocusStatRepository
                .findByUserAndDateBetweenOrderByDateAsc(user, from, to).stream()
                .collect(Collectors.toMap(DailyFocusStat::getDate, Function.identity()));

        List<HeatmapCellResponse> cells = new ArrayList<>();
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            DailyFocusStat s = byDate.get(d);
            if (s == null) {
                cells.add(new HeatmapCellResponse(d, 0, 0, false, 0, false));
            } else {
                cells.add(new HeatmapCellResponse(
                        d,
                        s.getTotalFocusMinutes(),
                        s.getSessionCount(),
                        s.isFocusGoalAchieved(),
                        s.getActualScreenTimeMinutes(),
                        s.isScreenTimeGoalAchieved()));
            }
        }
        return cells;
    }

    public StreakResponse getStreak(UUID userId) {
        User user = userRepository.getReferenceById(userId);
        return userStreakRepository.findByUser(user)
                .map(s -> new StreakResponse(s.getStreakCount(), s.getLongestStreak(), s.getLastSessionDate()))
                .orElseGet(() -> new StreakResponse(0, 0, null));
    }
}
