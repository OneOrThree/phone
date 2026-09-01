package com.oneorthree.phone.league;

import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import io.swagger.v3.oas.annotations.Parameter;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.UUID;

/**
 * {@code LeagueBatchController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 *
 * <p>파라미터 단위 {@code @Parameter} 는 구현체에 남는다 — 자바가 파라미터 애노테이션을
 * 상속하지 않아 여기 붙이면 스펙에서 사라진다.
 */
@Tag(name = "league-batch", description = "리그 주간 배치 수동 트리거 (local/dev/staging 전용)")
public interface LeagueBatchControllerDocs {

    /**
     * 이번 주차 정산을 처음부터 돌린다 — 랭킹 산정·승강 확정·아레나 마감·다음 주차 재편성까지 한 번에.
     * 같은 주차를 두 번 돌리는 것을 가드 anchor 로 막으므로, 중간에 깨진 주차는 이 API 가 아니라
     * {@link #resumeWeeklyBatch} 로 이어 붙여야 한다.
     *
     * @return 이번 실행이 처리한 유저·아레나 집계. 이미 실행된 주차면 409, 티어 설정이 없으면 500
     */
    @Operation(summary = "리그 주간 배치 수동 실행",
            description = "주간 랭킹 산정·승격/강등 확정·아레나 마감·다음 주차 재편성을 즉시 실행한다. "
                    + "티어 설정이 깨져 있으면 재실행 여부와 무관하게 500(TIER_CONFIG_NOT_FOUND — "
                    + "설정 검증이 anchor 생성보다 선행한다). 설정이 정상이고 이번 주차 배치가 이미 "
                    + "실행됐으면 409. 크래시·부분 실패 후 같은 주차를 마저 정산하려면 409 가 되므로 "
                    + "/league/batch/resume 을 쓴다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "배치 실행 성공"),
        @ApiResponse(responseCode = "409", description = "이번 주차 배치가 이미 실행됨 (BATCH_ALREADY_RUN)"),
        @ApiResponse(responseCode = "500",
                description = "리그 티어 설정 누락/손상 (TIER_CONFIG_NOT_FOUND) — anchor 생성 전에 실패")
    })
    ResponseEntity<LeagueBatchSummaryResponse> runWeeklyBatch();

    /**
     * 크래시·부분 실패로 남은 유저만 마저 정산한다. 주차를 <b>회전시키지 않으므로</b> 몇 번을 호출해도
     * 티어가 두 번 오르거나 보너스가 두 번 지급되지 않는다 — 이미 정산된 유저는 완료 마커로 건너뛴다.
     *
     * @param adminKey    {@code X-Batch-Admin-Key} 헤더 값. 서버에 키가 없으면 503, 틀리면 403
     * @param weekStartAt 정산할 주차의 시작(KST 월요일 00:00 의 ISO instant). 생략하면 호출 시각 기준
     *                    직전 주차를 잡는다. 지정하면 이미 다음 주차로 넘어간 뒤에도 과거 주차를 복구할 수 있다
     * @param userIds     표적 정산할 유저. 생략하면 그 주차의 미정산 유저 전체를 순회한다. 탈퇴·게스트·
     *                    주차 종료 후 가입한 유저는 지정해도 조용히 빠진다
     * @return 이번 호출이 새로 정산한 인원과 건너뛴 인원(alreadySettled). 대상 주차의 run 이 없었다면 409
     */
    @Operation(summary = "리그 주간 배치 재개(멱등 재실행 — 회전 없음)",
            description = "크래시·부분 실패로 남은 미정산 유저를 마저 정산한다(GROMO-1239). 절대 "
                    + "회전하지 않는다 — 대상 주차 run 이 커밋한 가드 anchor(주차 종료 경계 시각)가 "
                    + "없으면 409(BATCH_NOT_RUN)로 거부하니 최초 실행은 /league/batch/run 을 쓴다. "
                    + "기정산 유저는 완료 마커(league_weekly_results 유니크 행) 기준 "
                    + "alreadySettledMemberCount 로 건너뛴다 — 티어 재적용·보너스 이중 지급 없이 몇 "
                    + "번을 호출해도 안전하다(멱등). 두 모드: ① weekStartAt 생략 = 호출 시각 기준 "
                    + "직전 KST 주차 재개, ② weekStartAt 지정(정산 대상 주차의 KST 월요일 00:00 "
                    + "ISO instant, 예: 2026-08-02T15:00:00Z) = 다음 주차가 이미 회전한 뒤에도 그 "
                    + "과거 주차를 복구. 주차 종료 후 가입한 유저는 대상에서 제외되고(가입 컷오프), "
                    + "대상 주차보다 늦은 주차가 이미 정산된 유저는 티어 체인 보호를 위해 소급하지 "
                    + "않고 건너뛴다(alreadySettled 로 집계). "
                    + "userIds 를 지정하면 그 유저들만 표적 정산한다(실패 유저 복구용 — 탈퇴·게스트· "
                    + "컷오프 제외자는 조용히 빠진다). "
                    + "X-Batch-Admin-Key 헤더에 관리자 키(환경변수 BATCH_ADMIN_KEY)를 실어야 한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "재개 실행 성공(잔여 0명 포함)"),
        @ApiResponse(responseCode = "400",
                description = "weekStartAt 이 ISO instant 가 아니거나 KST 월요일 00:00 경계가 아님 "
                        + "(INVALID_WEEK_START)"),
        @ApiResponse(responseCode = "403", description = "관리자 키 누락/불일치 (BATCH_KEY_INVALID)"),
        @ApiResponse(responseCode = "409",
                description = "대상 주차의 배치가 실행된 적 없음 (BATCH_NOT_RUN) — /run 사용"),
        @ApiResponse(responseCode = "503", description = "서버에 관리자 키 미설정 (BATCH_KEY_NOT_CONFIGURED)")
    })
    ResponseEntity<LeagueBatchSummaryResponse> resumeWeeklyBatch(String adminKey,
            @Parameter(description = "정산 대상 주차 시작 — KST 월요일 00:00 ISO instant (생략 시 직전 주차)")
            String weekStartAt,
            @Parameter(description = "표적 정산할 유저 id 목록 (생략 시 전체 순회)")
            List<UUID> userIds);
}
