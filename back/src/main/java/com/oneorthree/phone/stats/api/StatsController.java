package com.oneorthree.phone.stats.api;

import com.oneorthree.phone.stats.dto.CategoryFocusStatsResponse;
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
            description = "현재 연속일·최장 연속일·마지막 집중일. 기록 없으면 0/0/null."
                    + " friends 지정 시 해당 친구(ACCEPTED)의 스트릭을 조회, 미지정 시 self.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "대상 유저 없음 또는 친구 관계 아님")
    })
    @GetMapping("/stats/streak")
    public ResponseEntity<StreakResponse> getStreak(
            @RequestParam(required = false) UUID friends,
            HttpServletRequest request) {
        UUID callerId = (UUID) request.getAttribute("userId");
        UUID targetId = statsService.resolveTargetUserId(callerId, friends);
        return ResponseEntity.ok(statsService.getStreak(targetId));
    }

    @Operation(summary = "오늘 요약 조회",
            description = "오늘의 집중·스크린타임 사용량·목표·목표 달성 진행도(%)를 통합 반환. 데이터 없으면 0/미달성."
                    + " friends 지정 시 해당 친구(ACCEPTED)의 오늘 요약을 조회, 미지정 시 self.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "대상 유저 없음 또는 친구 관계 아님")
    })
    @GetMapping("/stats/today")
    public ResponseEntity<TodayStatsResponse> getTodayStats(
            @RequestParam(required = false) UUID friends,
            HttpServletRequest request) {
        UUID callerId = (UUID) request.getAttribute("userId");
        UUID targetId = statsService.resolveTargetUserId(callerId, friends);
        return ResponseEntity.ok(statsService.getTodayStats(targetId));
    }

    @Operation(summary = "기간별 집중시간 통계 조회",
            description = "day(오늘)/week(이번 주 월~오늘)/month(이번 달 1일~오늘) 집중 시간 합계 + 직전 동일 기간 대비 delta 반환."
                    + " friends 지정 시 해당 친구(ACCEPTED)의 통계를 조회, 미지정 시 self.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "period 값 오류 (day|week|month 외)"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "대상 유저 없음 또는 친구 관계 아님")
    })
    @GetMapping("/stats/focus")
    public ResponseEntity<FocusPeriodStatsResponse> getFocusStatsByPeriod(
            @RequestParam StatsPeriod period,
            @RequestParam(required = false) UUID friends,
            HttpServletRequest request) {
        UUID callerId = (UUID) request.getAttribute("userId");
        UUID targetId = statsService.resolveTargetUserId(callerId, friends);
        return ResponseEntity.ok(statsService.getFocusStatsByPeriod(targetId, period));
    }

    @Operation(summary = "카테고리별 집중 통계 조회",
            description = "day(오늘)/week(이번 주 월~오늘)/month(이번 달 1일~오늘) 기간의 "
                    + "완료된 세션을 태그별로 집계. 비율(%)은 클라이언트가 totalFocusMinutes 합계로 계산.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공 (데이터 없으면 items=[], totalFocusMinutes=0)"),
        @ApiResponse(responseCode = "400", description = "period 값 오류 (day|week|month 외)"),
        @ApiResponse(responseCode = "401", description = "인증 필요")
    })
    @GetMapping("/stats/by-category")
    public ResponseEntity<CategoryFocusStatsResponse> getFocusStatsByCategory(
            @RequestParam StatsPeriod period,
            HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(statsService.getFocusStatsByCategory(userId, period));
    }

    @Operation(summary = "기간별 스크린타임 통계 조회",
            description = "day·week·month 기간별 스크린타임 합계, 직전 기간 대비 delta, 목표 달성 정보 반환."
                    + " day 단위 goalAchieved: 목표가 설정된 경우(goalMinutes > 0)에만 유효하며,"
                    + " 사용량이 목표 이내(0분 포함)이면 달성. 목표 미설정 시 false."
                    + " friends 지정 시 해당 친구(ACCEPTED)의 통계를 조회, 미지정 시 self.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "잘못된 period 값"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "대상 유저 없음 또는 친구 관계 아님")
    })
    @GetMapping("/stats/screen-time")
    public ResponseEntity<ScreenTimePeriodStatsResponse> getScreenTimePeriodStats(
            @RequestParam StatsPeriod period,
            @RequestParam(required = false) UUID friends,
            HttpServletRequest request) {
        UUID callerId = (UUID) request.getAttribute("userId");
        UUID targetId = statsService.resolveTargetUserId(callerId, friends);
        return ResponseEntity.ok(statsService.getScreenTimePeriodStats(targetId, period));
    }
}
