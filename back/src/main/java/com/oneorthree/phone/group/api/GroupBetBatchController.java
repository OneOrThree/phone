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
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

// 운영 수동 트리거(MANUAL) — LLD §2.3: 정산 트리거는 <b>prod 포함</b> 전 환경에 연다. 24h 자동
// 환불이 최후 방어선이지만 그 전에 손으로 풀 수단이 있어야 한다(스케줄러 장애 복구가 정확히 그
// 상황이다). 종전 @Profile({"local","dev","staging"}) 게이팅은 그 복구 경로를 prod 에서 막고
// 있었다(GROMO-1411 후속). 인가는 관리자 키(X-Batch-Admin-Key 헤더 ↔ 환경변수 BATCH_ADMIN_KEY)
// 가 계속 진다 — 키 미설정 503 · 불일치 403 · 상수 시간 비교. 감사 로그(§2.3 필수): 호출 시각은
// 로그 타임스탬프, 호출자는 관리자 키 단일 주체(개인 식별 축 없음 — 키 소지 = 운영자), 대상
// 회차·결과는 아래 warn 요약 + 회차별 정산 로그(GroupBetSettler)가 남긴다.
@Slf4j
@Tag(name = "group-bet-batch", description = "그룹 챌린지 내기 정산 수동 트리거 (전 환경 — 관리자 키 필수)")
@RestController
@RequestMapping("/api/v1")
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
    @PostMapping("/groups/bets/settle")
    public ResponseEntity<GroupBetSettlementSummaryResponse> settleDueBets(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey,
            @Parameter(description = "정산할 챌린지 카테고리 (생략 시 전체)")
            @RequestParam(required = false) MissionCategory category) {
        requireAdminKey(adminKey);
        // 감사 로그(LLD §2.3) — prod 포함 경로라 호출 사실·대상·결과를 warn 으로 남긴다.
        log.warn("내기 정산 수동 트리거(MANUAL) 호출 — category={}", category == null ? "ALL" : category);
        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(category);
        log.warn("내기 정산 수동 트리거(MANUAL) 완료 — category={}, 대상={}, 분배={}, 몰수={}, 환불={}, "
                + "스킵={}, 실패={}",
                category == null ? "ALL" : category, summary.targetCount(), summary.settledCount(),
                summary.forfeitedCount(), summary.refundedCount(), summary.skippedCount(),
                summary.failedCount());
        return ResponseEntity.ok(summary);
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
