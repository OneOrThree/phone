package com.oneorthree.phone.league.api;

import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueScheduleResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.league.service.LeagueService;
import com.oneorthree.phone.user.domain.Occupation;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@Tag(name = "league", description = "리그/티어 조회 API")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class LeagueController {

    private final LeagueService leagueService;

    @Operation(summary = "내 현재 리그·티어 조회",
            description = "현재 ACTIVE 아레나의 티어·주차 정보. 미배정이면 assigned=false.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    @GetMapping("/league/me/tier")
    public ResponseEntity<LeagueTierResponse> getMyTier(HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(leagueService.getMyTier(userId));
    }

    @Operation(summary = "티어 멤버 랭킹 조회",
            description = "category 미지정: 현재 ACTIVE 아레나 멤버 랭킹(totalFocusSeconds 내림차순). 미배정이면 빈 배열. "
                    + "category 지정: 전역 같은 occupation 유저 상위 100명 랭킹(아레나 무관). "
                    + "잘못된 category 값은 400 INVALID_PARAMETER.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "잘못된 category 파라미터")
    })
    @GetMapping("/league/me/ranking")
    public ResponseEntity<List<LeagueMemberResponse>> getMyRanking(
            HttpServletRequest request,
            @RequestParam(required = false) Occupation category) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(leagueService.getMyRanking(userId, category));
    }

    @Operation(summary = "전역 전체 유저 랭킹 조회",
            description = "직군 무관 전역 랭킹. 이번 주 ACTIVE 아레나 전체를 가로질러 totalFocusSeconds 내림차순 상위 limit 명. "
                    + "rank 는 아레나가 아닌 전역 순번. scope 는 total(대소문자 무관)만 지원, 그 외 값은 400 INVALID_SCOPE. "
                    + "limit 는 1~500 으로 클램프된다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "지원하지 않는 scope 값(INVALID_SCOPE) 또는 limit 형식 오류")
    })
    // 전역 랭킹은 유저 컨텍스트가 필요 없다(직군·본인 무관 집계). 인증은 JwtFilter(/api/*)가 강제하므로
    // 핸들러에서 userId 를 읽지 않는다. request 파라미터도 불필요.
    @GetMapping("/league/ranking")
    public ResponseEntity<List<LeagueMemberResponse>> getGlobalRanking(
            @RequestParam(required = false, defaultValue = "total") String scope,
            @RequestParam(required = false, defaultValue = "100") int limit) {
        return ResponseEntity.ok(leagueService.getGlobalRanking(scope, limit));
    }

    @Operation(summary = "내 순위·승격/강등 상태 조회",
            description = "현재 아레나에서 내 순위와 결과. 진행 중엔 result=null, 확정 시 값. 미배정이면 assigned=false.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    @GetMapping("/league/me/rank")
    public ResponseEntity<LeagueRankResponse> getMyRank(HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(leagueService.getMyRank(userId));
    }

    @Operation(summary = "리그 마감 스케줄 조회",
            description = "다음 리그 마감(다음 월요일 00:00 KST) 시각과 그때까지 남은 시간(초)을 반환한다. "
                    + "미배정 유저도 항상 200. 클라이언트 홈·리그 화면의 마감 카운트다운용.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    @GetMapping("/league/me/schedule")
    public ResponseEntity<LeagueScheduleResponse> getMySchedule(HttpServletRequest request) {
        UUID userId = (UUID) request.getAttribute("userId");
        return ResponseEntity.ok(leagueService.getMySchedule(userId));
    }
}
