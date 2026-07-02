package com.oneorthree.phone.league.api;

import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.service.LeagueBatchService;
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

// 운영/테스트용 수동 트리거 — 프로파일 게이팅으로 prod 미노출.
// TODO: 정식 관리자 권한(인증/인가) 설계는 별도 백로그 티켓
@Tag(name = "league-batch", description = "리그 주간 배치 수동 트리거 (local/dev/staging 전용)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
@Profile({"local", "dev", "staging"})
public class LeagueBatchController {

    private final LeagueBatchService leagueBatchService;

    @Operation(summary = "리그 주간 배치 수동 실행",
            description = "주간 랭킹 산정·승격/강등 확정·아레나 마감·다음 주차 재편성을 즉시 실행한다. "
                    + "이미 이번 주차 배치가 실행됐으면 409.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "배치 실행 성공"),
        @ApiResponse(responseCode = "409", description = "이번 주차 배치가 이미 실행됨")
    })
    @PostMapping("/league/batch/run")
    public ResponseEntity<LeagueBatchSummaryResponse> runWeeklyBatch() {
        return ResponseEntity.ok(leagueBatchService.runWeeklyBatch());
    }
}
