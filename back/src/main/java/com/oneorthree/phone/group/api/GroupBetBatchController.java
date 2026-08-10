package com.oneorthree.phone.group.api;

import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.service.GroupBetSettlementService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

// 운영/테스트용 수동 트리거 — 프로파일 게이팅으로 prod 미노출 (LeagueBatchController 와 같은 관행).
// 프로파일에 더해 관리자 키(X-Batch-Admin-Key 헤더 ↔ 환경변수 BATCH_ADMIN_KEY)를 요구한다 —
// 종전엔 유효한 JWT 만 있으면 아무 로그인 유저나 전체 그룹의 미정산 내기를 강제 조기 정산시킬 수 있었다.
@Tag(name = "group-bet-batch", description = "그룹 챌린지 내기 일 정산 수동 트리거 (local/dev/staging 전용)")
@RestController
@RequestMapping("/api/v1")
@Profile({"local", "dev", "staging"})
public class GroupBetBatchController {

    /** 관리자 키 요청 헤더 — 환경변수 {@code BATCH_ADMIN_KEY} 값과 일치해야 한다. */
    public static final String ADMIN_KEY_HEADER = "X-Batch-Admin-Key";

    private final GroupBetSettlementService groupBetSettlementService;
    private final String batchAdminKey;

    // 키 미설정은 기동 실패가 아니라 503 응답으로 처리한다(스펙) — 그래서 default 를 "" 로 둔다.
    public GroupBetBatchController(GroupBetSettlementService groupBetSettlementService,
                                   @Value("${BATCH_ADMIN_KEY:}") String batchAdminKey) {
        this.groupBetSettlementService = groupBetSettlementService;
        this.batchAdminKey = batchAdminKey;
    }

    @Operation(summary = "내기 일 정산 배치 수동 실행 (MANUAL 트리거)",
            description = "전일자까지의 OPEN 회차를 훑어 정산 단일 진입점(settle, GROMO-1411)에 넘긴다."
                    + " 가드는 회차별 settle_after 가 진다 — 그레이스 미경과 회차(예: 아침 보고를"
                    + " 기다리는 SCREEN_TIME 하루형은 익일 12:00 전)는 skippedCount 로 스킵되므로,"
                    + " 어느 시각에 호출해도 조기 정산 사고가 없다. 정산 24h 데드라인을 넘긴 회차는"
                    + " 정산 대신 자동 전원 환불되어 refundedCount 로 집계된다(N21)."
                    + " category 파라미터로 대상을 좁힐 수 있고, 생략하면 전 카테고리다."
                    + " 이미 정산된 내기는 스킵되므로 반복 호출해도 이중 지급이 없다."
                    + " 실패 건은 그 내기만 롤백되고 failedCount 로 집계된다."
                    + " X-Batch-Admin-Key 헤더에 관리자 키(환경변수 BATCH_ADMIN_KEY)를 실어야 한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "배치 실행 성공(대상 0건 포함)"),
        @ApiResponse(responseCode = "403", description = "관리자 키 누락/불일치 (BATCH_KEY_INVALID)"),
        @ApiResponse(responseCode = "503", description = "서버에 관리자 키 미설정 (BATCH_KEY_NOT_CONFIGURED)")
    })
    @PostMapping("/groups/bets/settle")
    public ResponseEntity<GroupBetSettlementSummaryResponse> settleDueBets(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey,
            @Parameter(description = "정산할 챌린지 카테고리 (생략 시 전체)")
            @RequestParam(required = false) MissionCategory category) {
        requireAdminKey(adminKey);
        return ResponseEntity.ok(groupBetSettlementService.settleDueBets(category));
    }

    // 비교는 MessageDigest.isEqual — String.equals 는 첫 불일치 문자에서 끊겨 응답 시간으로
    // 키가 새는 이론적 여지가 있어 상수 시간 비교를 쓴다.
    private void requireAdminKey(String provided) {
        if (batchAdminKey.isBlank()) {
            throw new GroupException(GroupErrorCode.BATCH_KEY_NOT_CONFIGURED);
        }
        byte[] expected = batchAdminKey.getBytes(StandardCharsets.UTF_8);
        byte[] actual = provided == null ? new byte[0] : provided.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, actual)) {
            throw new GroupException(GroupErrorCode.BATCH_KEY_INVALID);
        }
    }
}
