package com.oneorthree.phone.group;

import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

/**
 * {@code GroupBetBatchController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 *
 * <p>파라미터 단위 {@code @Parameter} 는 구현체에 남는다 — 자바가 파라미터 애노테이션을
 * 상속하지 않아 여기 붙이면 스펙에서 사라진다.
 */
@Tag(name = "group-bet-batch", description = "그룹 챌린지 내기 정산 수동 트리거 (전 환경 — 관리자 키 필수)")
public interface GroupBetBatchControllerDocs {

    /**
     * @param adminKey 관리자 키 헤더
     * @param category 대상 카테고리
     * @return 정산 결과 요약
     */
    @Operation(summary = "내기 정산 배치 수동 실행 (MANUAL 트리거 · prod 포함)",
            description = "정산 가능 시각(settle_after)이 지난 OPEN 회차를 훑어 정산 단일 진입점"
                    + "(settle, GROMO-1411)에 넘긴다. 대상 선택이 회차별 settle_after 기준이라"
                    + " 오전에 끝난 창형 등 **당일 회차도 즉시 복구**할 수 있다(종전 날짜 축은 당일"
                    + " 회차를 못 잡아 24h 자동 환불까지 갔다). 5분 스캔과 달리 재시도 백오프는"
                    + " 무시한다 — 지금 재시도하겠다는 뜻이다."
                    + " 가드는 정산 본체가 진다 — 그레이스 미경과 회차(예: 아침 보고를 기다리는"
                    + " SCREEN_TIME 하루형은 익일 12:00 전)와 창 겹침 집중 세션 대기 회차는"
                    + " skippedCount 로 스킵되므로, 어느 시각에 호출해도 조기 정산 사고가 없다."
                    + " 정산 24h 데드라인을 넘긴 회차는 정산 대신 자동 전원 환불되어"
                    + " refundedCount 로 집계된다(N21)."
                    + " category 파라미터로 대상을 좁힐 수 있고, 생략하면 전 카테고리다."
                    + " 이미 정산된 내기는 스킵되므로 반복 호출해도 이중 지급이 없다."
                    + " 실패 건은 그 내기만 롤백되고 failedCount 로 집계된다."
                    + " X-Batch-Admin-Key 헤더에 관리자 키(환경변수 BATCH_ADMIN_KEY)를 실어야 한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "배치 실행 성공(대상 0건 포함)"),
        @ApiResponse(responseCode = "403", description = "관리자 키 누락/불일치 (BATCH_KEY_INVALID)"),
        @ApiResponse(responseCode = "503", description = "서버에 관리자 키 미설정 (BATCH_KEY_NOT_CONFIGURED)")
    })
    ResponseEntity<GroupBetSettlementSummaryResponse> settleDueBets(String adminKey, MissionCategory category);
}
