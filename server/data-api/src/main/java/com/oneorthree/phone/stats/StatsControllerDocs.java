package com.oneorthree.phone.stats;

import com.oneorthree.phone.stats.dto.CategoryFocusStatsResponse;
import com.oneorthree.phone.stats.dto.FocusAverageResponse;
import com.oneorthree.phone.stats.dto.FocusAverageScope;
import com.oneorthree.phone.stats.dto.FocusPeriodStatsResponse;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.ScreenTimePeriodStatsResponse;
import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * {@code StatsController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "stats", description = "홈 화면 통계 조회 API (스트릭·일별 집중 집계)")
public interface StatsControllerDocs {

    @Operation(summary = "일별 집중 집계(히트맵) 조회",
            description = "[from,to] 범위의 모든 날짜를 반환(데이터 없는 날은 0). 범위 상한 366일.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "from/to 누락·역순·범위 초과"),
        @ApiResponse(responseCode = "401", description = "인증 필요")
    })
    ResponseEntity<List<HeatmapCellResponse>> getHeatmap(LocalDate from, LocalDate to, UUID userId);

    @Operation(summary = "스트릭(연속일) 조회",
            description = "현재 연속일·최장 연속일·마지막 집중일. 기록 없으면 0/0/null."
                    + " currentStreak 은 read-time 으로 만료된다(GROMO-847): lastSessionDate 가 어제 이전이면"
                    + " 공백으로 끊긴 것으로 보아 0 을 반환한다(longestStreak·lastSessionDate 는 원본 유지)."
                    + " date 는 서버 판정 축(KST 고정, GROMO-1259) 기준 '오늘'(required)"
                    + " — 기기 로컬 날짜가 아니다. 로컬 날짜를 보내면 비-KST 기기에서 인접 버킷이 조회된다."
                    + " friends 지정 시 해당 친구(또는 PUBLIC)의 스트릭을 조회, 미지정 시 self.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "date 누락·형식 오류"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "대상 유저 없음 또는 친구 관계 아님")
    })
    ResponseEntity<StreakResponse> getStreak(LocalDate date, UUID friends, UUID callerId);

    @Operation(summary = "오늘 요약 조회",
            description = "오늘의 집중·스크린타임 사용량·목표·목표 달성 진행도(%)를 통합 반환. 데이터 없으면 0/미달성."
                    + " friends 지정 시 해당 친구(또는 PUBLIC)의 오늘 요약을 조회, 미지정 시 self.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "대상 유저 없음 또는 친구 관계 아님")
    })
    ResponseEntity<TodayStatsResponse> getTodayStats(LocalDate date, UUID friends, UUID callerId);

    @Operation(summary = "기간별 집중시간 통계 조회",
            description = "day(오늘)/week(이번 주 월~오늘)/month(이번 달 1일~오늘) 집중 시간 합계 + 직전 동일 기간 대비 delta 반환."
                    + " friends 지정 시 해당 친구(또는 PUBLIC)의 통계를 조회, 미지정 시 self.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "period 값 오류 (day|week|month 외)"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "대상 유저 없음 또는 친구 관계 아님")
    })
    ResponseEntity<FocusPeriodStatsResponse> getFocusStatsByPeriod(StatsPeriod period, LocalDate date,
            UUID friends, UUID callerId);

    @Operation(summary = "기간별 평균 집중시간 집계 조회",
            description = "scope(friends|total|category) × period(day|week|month) 로 활동 유저 1인당 평균 집중 시간(분) 반환."
                    + " 모수는 해당 기간 활동(row≥1) 유저만(휴면 제외). 집계라 per-user 열람권한 불요."
                    + " friends=자기 자신 제외한 ACCEPTED 친구, total=전체 유저(자기 포함), category=같은 occupation(자기 포함)."
                    + " occupation 미설정 상태로 category 조회 시 400 아닌 averageMinutes=null."
                    + " 활동 유저 0명이면 averageMinutes=null, sampleSize=0.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공 (무활동/미설정이면 averageMinutes=null, sampleSize=0)"),
        @ApiResponse(responseCode = "400", description = "scope/period 값 오류 또는 date 누락"),
        @ApiResponse(responseCode = "401", description = "인증 필요")
    })
    ResponseEntity<FocusAverageResponse> getFocusAverage(FocusAverageScope scope, StatsPeriod period,
            LocalDate date, UUID callerId);

    @Operation(summary = "카테고리별 집중 통계 조회",
            description = "day(오늘)/week(이번 주 월~오늘)/month(이번 달 1일~오늘) 기간의 "
                    + "완료된 세션을 태그별로 집계. 비율(%)은 클라이언트가 totalFocusMinutes 합계로 계산."
                    + " friends 지정 시 해당 친구(또는 PUBLIC)의 통계를 조회, 미지정 시 self.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공 (데이터 없으면 items=[], totalFocusMinutes=0)"),
        @ApiResponse(responseCode = "400", description = "period 값 오류 (day|week|month 외)"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "대상 유저 없음 또는 열람 권한 없음(친구 아님·비공개)")
    })
    ResponseEntity<CategoryFocusStatsResponse> getFocusStatsByCategory(StatsPeriod period, LocalDate date,
            UUID friends, UUID callerId);

    @Operation(summary = "기간별 스크린타임 통계 조회",
            description = "day·week·month 기간별 스크린타임 합계, 직전 기간 대비 delta, 목표 달성 정보 반환."
                    + " day 단위 goalAchieved: 목표가 설정된 경우(goalMinutes > 0)에만 유효하며,"
                    + " 사용량이 목표 이내(0분 포함)이면 달성. 목표 미설정 시 false."
                    + " friends 지정 시 해당 친구(또는 PUBLIC)의 통계를 조회, 미지정 시 self.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "잘못된 period 값"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "대상 유저 없음 또는 친구 관계 아님")
    })
    ResponseEntity<ScreenTimePeriodStatsResponse> getScreenTimePeriodStats(StatsPeriod period, LocalDate date,
            UUID friends, UUID callerId);
}
