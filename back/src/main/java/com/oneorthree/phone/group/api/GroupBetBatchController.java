package com.oneorthree.phone.group.api;

import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.service.GroupBetSettlementService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// 운영/테스트용 수동 트리거 — 프로파일 게이팅으로 prod 미노출 (LeagueBatchController 와 같은 관행).
// TODO: 정식 관리자 권한(인증/인가) 설계는 별도 백로그 티켓
@Tag(name = "group-bet-batch", description = "그룹 챌린지 내기 일 정산 수동 트리거 (local/dev/staging 전용)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
@Profile({"local", "dev", "staging"})
public class GroupBetBatchController {

    private final GroupBetSettlementService groupBetSettlementService;

    @Operation(summary = "내기 일 정산 배치 수동 실행",
            description = "그레이스 4시간이 끝난 날짜까지의 OPEN 내기를 전건 정산한다(스케줄 배치와 같은 기준일)."
                    + " 00:00~04:00 KST 에 호출해도 전일자 내기는 그레이스가 끝날 때까지 대상에서 빠진다."
                    + " 이미 정산된 내기는 스킵되므로 반복 호출해도 이중 지급이 없다."
                    + " 실패 건은 그 내기만 롤백되고 failedCount 로 집계된다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "배치 실행 성공(대상 0건 포함)")
    })
    @PostMapping("/groups/bets/settle")
    public ResponseEntity<GroupBetSettlementSummaryResponse> settleDueBets() {
        return ResponseEntity.ok(groupBetSettlementService.settleDueBets());
    }
}
