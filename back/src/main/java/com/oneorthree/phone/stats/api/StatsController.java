package com.oneorthree.phone.stats.api;

import com.oneorthree.phone.common.auth.LoginUser;
import com.oneorthree.phone.stats.api.docs.StatsControllerDocs;
import com.oneorthree.phone.stats.dto.CategoryFocusStatsResponse;
import com.oneorthree.phone.stats.dto.FocusAverageResponse;
import com.oneorthree.phone.stats.dto.FocusAverageScope;
import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.ScreenTimePeriodStatsResponse;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.service.StatsService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 홈 화면 통계 API. Swagger 애노테이션은 {@link StatsControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class StatsController implements StatsControllerDocs {

    private final StatsService statsService;

    @Override
    @GetMapping("/stats/heatmap")
    public ResponseEntity<List<HeatmapCellResponse>> getHeatmap(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @LoginUser UUID userId) {
        return ResponseEntity.ok(statsService.getHeatmap(userId, from, to));
    }

    @Override
    @GetMapping("/stats/streak")
    public ResponseEntity<StreakResponse> getStreak(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) UUID friends,
            @LoginUser UUID callerId) {
        UUID targetId = statsService.resolveTargetUserId(callerId, friends);
        return ResponseEntity.ok(statsService.getStreak(targetId, date));
    }

    @Override
    @GetMapping("/stats/today")
    public ResponseEntity<TodayStatsResponse> getTodayStats(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) UUID friends,
            @LoginUser UUID callerId) {
        UUID targetId = statsService.resolveTargetUserId(callerId, friends);
        return ResponseEntity.ok(statsService.getTodayStats(targetId, date));
    }

    @Override
    @GetMapping("/stats/focus")
    public ResponseEntity<FocusPeriodStatsResponse> getFocusStatsByPeriod(
            @RequestParam StatsPeriod period,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) UUID friends,
            @LoginUser UUID callerId) {
        UUID targetId = statsService.resolveTargetUserId(callerId, friends);
        return ResponseEntity.ok(statsService.getFocusStatsByPeriod(targetId, period, date));
    }

    @Override
    @GetMapping("/stats/focus/average")
    public ResponseEntity<FocusAverageResponse> getFocusAverage(
            @RequestParam FocusAverageScope scope,
            @RequestParam StatsPeriod period,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @LoginUser UUID callerId) {
        return ResponseEntity.ok(statsService.getFocusAverage(callerId, scope, period, date));
    }

    @Override
    @GetMapping("/stats/by-category")
    public ResponseEntity<CategoryFocusStatsResponse> getFocusStatsByCategory(
            @RequestParam StatsPeriod period,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) UUID friends,
            @LoginUser UUID callerId) {
        UUID targetId = statsService.resolveTargetUserId(callerId, friends);
        return ResponseEntity.ok(statsService.getFocusStatsByCategory(targetId, period, date));
    }

    @Override
    @GetMapping("/stats/screen-time")
    public ResponseEntity<ScreenTimePeriodStatsResponse> getScreenTimePeriodStats(
            @RequestParam StatsPeriod period,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) UUID friends,
            @LoginUser UUID callerId) {
        UUID targetId = statsService.resolveTargetUserId(callerId, friends);
        return ResponseEntity.ok(statsService.getScreenTimePeriodStats(targetId, period, date));
    }
}
