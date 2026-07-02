package com.oneorthree.phone.stats.api;

import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.ScreenTimePeriodStatsResponse;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.service.StatsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
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

@Tag(name = "stats", description = "홈 화면 통계 조회 API (스트릭·일별 집중 집계)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class StatsController {

    private final StatsService statsService;

    @Operation(summary = "일별 집중 집계(히트맵) 조회",
            description = "[from,to] 범위의 모든 날짜를 반환(데이터 없는 날은 0). 범위 상한 366일.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "from/to 누락·역순·범위 초과"),
        @ApiResponse(responseCode = "401", description = "인증 필요")
    })
    @GetMapping("/stats/heatmap")
    public ResponseEntity<List<HeatmapCellResponse>> getHeatmap(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(statsService.getHeatmap(userId, from, to));
    }

    @Operation(summary = "스트릭(연속일) 조회",
            description = "현재 연속일·최장 연속일·마지막 집중일. 기록 없으면 0/0/null.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요")
    })
    @GetMapping("/stats/streak")
    public ResponseEntity<StreakResponse> getStreak(HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(statsService.getStreak(userId));
    }

    @Operation(summary = "오늘 요약 조회",
            description = "오늘의 집중·스크린타임 사용량·목표·목표 달성 진행도(%)를 통합 반환. 데이터 없으면 0/미달성.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @GetMapping("/stats/today")
    public ResponseEntity<TodayStatsResponse> getTodayStats(HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(statsService.getTodayStats(userId));
    }

    @Operation(summary = "기간별 집중시간 통계 조회",
            description = "day(오늘)/week(이번 주 월~오늘)/month(이번 달 1일~오늘) 집중 시간 합계 + 직전 동일 기간 대비 delta 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "period 값 오류 (day|week|month 외)"),
        @ApiResponse(responseCode = "401", description = "인증 필요")
    })
    @GetMapping("/stats/focus")
    public ResponseEntity<FocusPeriodStatsResponse> getFocusStatsByPeriod(
            @RequestParam StatsPeriod period,
            HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(statsService.getFocusStatsByPeriod(userId, period));
    }

    @Operation(summary = "기간별 스크린타임 통계 조회",
            description = "day·week·month 기간별 스크린타임 합계, 직전 기간 대비 delta, 목표 달성 정보 반환."
                    + " day 단위에서 오늘 사용 기록이 없으면(0분) 목표 설정 시 달성으로 간주.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "잘못된 period 값"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    @GetMapping("/stats/screen-time")
    public ResponseEntity<ScreenTimePeriodStatsResponse> getScreenTimePeriodStats(
            @RequestParam StatsPeriod period,
            HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(statsService.getScreenTimePeriodStats(userId, period));
    }
}
