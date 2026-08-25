package com.oneorthree.phone.league.api.docs;

import com.oneorthree.phone.league.dto.LeagueLastResultAckRequest;
import com.oneorthree.phone.league.dto.LeagueLastResultResponse;
import com.oneorthree.phone.league.dto.LeagueMemberResponse;
import com.oneorthree.phone.league.dto.LeagueRankResponse;
import com.oneorthree.phone.league.dto.LeagueScheduleResponse;
import com.oneorthree.phone.league.dto.LeagueTierResponse;
import com.oneorthree.phone.user.domain.Occupation;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * {@code LeagueController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "league", description = "리그/티어 조회 API")
public interface LeagueControllerDocs {

    @Operation(summary = "내 현재 리그·티어 조회",
            description = "users.tier_level에 저장된 현재 티어와 KST 기준 주차 정보를 반환한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    ResponseEntity<LeagueTierResponse> getMyTier(UUID userId);

    @Operation(summary = "전역 주간 랭킹 조회",
            description = "category 미지정: DailyFocusStat 기반 전역 주간 상위 100명 랭킹. "
                    + "category 지정: 같은 occupation 활성 사용자의 전역 주간 상위 100명 랭킹. "
                    + "각 멤버의 집중 라이브 정보(isFocusing·focusTimeMinutes·focusStartedAt·focusTagName)와 "
                    + "조회자 기준 친구 여부(isFriend)를 포함한다. "
                    + "date 는 서버 판정 축(KST 고정, GROMO-1259) 기준 오늘(YYYY-MM-DD, required) "
                    + "— 기기 로컬 날짜가 아니다. "
                    + "잘못된 category 값·date 누락은 400 INVALID_PARAMETER.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "잘못된 category 파라미터 또는 date 누락·형식 오류")
    })
    ResponseEntity<List<LeagueMemberResponse>> getMyRanking(UUID userId, Occupation category, LocalDate date);

    @Operation(summary = "전역 전체 유저 랭킹 조회",
            description = "직군 무관 DailyFocusStat 기반 전역 주간 랭킹의 totalFocusSeconds 내림차순 상위 limit 명. "
                    + "rank 는 아레나가 아닌 전역 순번. 각 멤버의 isFriend 는 조회자 기준 친구 여부(GROMO-1630), "
                    + "isPinned 는 전역 스코프 밖이라 항상 false. "
                    + "scope 는 total(대소문자 무관)만 지원, 그 외 값은 400 INVALID_SCOPE. "
                    + "limit 는 1~500 으로 클램프된다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "지원하지 않는 scope 값(INVALID_SCOPE) 또는 limit 형식 오류")
    })
    ResponseEntity<List<LeagueMemberResponse>> getGlobalRanking(UUID userId, String scope, int limit);

    @Operation(summary = "내 순위 조회",
            description = "DailyFocusStat 기반 현재 전역 주간 순위(assigned·myRank·totalFocusSeconds)를 반환한다. "
                    + "정산 결과 노출은 이 응답에서 분리되었다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    ResponseEntity<LeagueRankResponse> getMyRank(UUID userId);

    @Operation(summary = "리그 마감 스케줄 조회",
            description = "다음 리그 마감(다음 월요일 00:00 KST) 시각과 그때까지 남은 시간(초)을 반환한다. "
                    + "미배정 유저도 항상 200. 클라이언트 홈·리그 화면의 마감 카운트다운용.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    ResponseEntity<LeagueScheduleResponse> getMySchedule(UUID userId);

    @Operation(summary = "주간 마감 결과 조회",
            description = "주간 배치가 남긴 최신 정산 결과 1건을 반환한다. 결과 행이 없으면(미배정/신규 유저) "
                    + "hasResult=false. 클라는 리그 탭 첫 진입 시 hasResult && !acknowledged 이면 결과 모달을 노출한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    ResponseEntity<LeagueLastResultResponse> getLastResult(UUID userId);

    @Operation(summary = "주간 마감 결과 확인 처리(ack)",
            description = "GET 으로 받은 결과의 weekStartAt 을 실어 보내면 그 주차 결과를 확인 처리해 다시 노출되지 않게 한다. "
                    + "ack 시점에 최신행을 다시 찾지 않고 이 주차를 대상으로 하므로, 그 사이 배치가 새 주차 결과를 넣어도 "
                    + "유저가 못 본 결과를 삼키지 않는다. 대상 행 없음·이미 확인됨·동시 중복 호출 모두 no-op 이며 멱등하다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "확인 처리 성공(멱등)")
    })
    ResponseEntity<Void> acknowledgeLastResult(UUID userId, LeagueLastResultAckRequest body);
}
