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
import jakarta.servlet.http.HttpServletRequest;
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
import java.time.Instant;

// 수동 정산 트리거 — 관리자 키(X-Batch-Admin-Key 헤더 ↔ 환경변수 BATCH_ADMIN_KEY)를 요구한다.
// 종전엔 유효한 JWT 만 있으면 아무 로그인 유저나 전체 그룹의 미정산 내기를 강제 조기 정산시킬 수 있었다.
//
// prod 개방 (GROMO-1258, 정책 §E1): 종전의 @Profile({"local","dev","staging"}) 게이팅을 걷어냈다.
// 정산이 영구 실패해 판돈이 동결됐을 때 prod 에서 이를 푸는 수단이 "재배포" 뿐이었고, 그 공백이
// "참가비가 영원히 묶이지 않는다"를 사람 손에 맡기는 원인이었다. 프로파일 대신 ① 관리자 키
// (상수 시간 비교) ② 호출자·시각·대상 건수 감사 로그 두 겹으로 막는다 — 프로파일은 원래도
// 인가 수단이 아니라 노출 억제였다.
@Slf4j
@Tag(name = "group-bet-batch", description = "그룹 챌린지 내기 일 정산 수동 트리거 (관리자 키 필요)")
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

    @Operation(summary = "내기 일 정산 배치 수동 실행",
            description = "그레이스 1시간이 끝난 날짜까지의 OPEN 내기를 정산한다(스케줄 배치와 같은 기준일)."
                    + " 00:00~01:00 KST 에 호출해도 전일자 내기는 그레이스가 끝날 때까지 대상에서 빠진다."
                    + " category 파라미터로 스케줄 배치와 같은 분할(FOCUS=01:00분, SCREEN_TIME=12:00분)을"
                    + " 재현할 수 있고, 생략하면 전 카테고리를 정산한다."
                    + " ⚠️ 생략(전체) 호출은 그레이스가 카테고리별 최적 시각을 존중하지 않는다 —"
                    + " 02:00~11:59 KST 에 호출하면 전일자 SCREEN_TIME 내기가 '아침 첫 앱 실행 보고'"
                    + " 기회를 받기 전에 정산돼 미보고=미달성 패배로 확정된다."
                    + " 그 시간대에는 category=FOCUS 를 명시하는 편이 안전하다."
                    + " 이미 정산된 내기는 스킵되므로 반복 호출해도 이중 지급이 없다."
                    + " 실패 건은 그 내기만 롤백되고 failedCount 로 집계된다."
                    + " X-Batch-Admin-Key 헤더에 관리자 키(환경변수 BATCH_ADMIN_KEY)를 실어야 하며,"
                    + " 호출자·시각·대상 건수는 감사 로그로 남는다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "배치 실행 성공(대상 0건 포함)"),
        @ApiResponse(responseCode = "403", description = "관리자 키 누락/불일치 (BATCH_KEY_INVALID)"),
        @ApiResponse(responseCode = "503", description = "서버에 관리자 키 미설정 (BATCH_KEY_NOT_CONFIGURED)")
    })
    @PostMapping("/groups/bets/settle")
    public ResponseEntity<GroupBetSettlementSummaryResponse> settleDueBets(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey,
            @Parameter(description = "정산할 챌린지 카테고리 (생략 시 전체)")
            @RequestParam(required = false) MissionCategory category,
            HttpServletRequest request) {
        requireAdminKey(adminKey);
        // 감사 로그(GROMO-1258) — prod 에서도 열리는 엔드포인트라 "누가·언제 돈을 움직였나"가
        // 남아야 한다. 실행 전후 두 줄인 이유: 배치가 도중에 죽으면 완료 줄이 없어 그 자체가 신호다.
        Instant requestedAt = Instant.now();
        String caller = callerOf(request);
        log.warn("내기 정산 수동 트리거 요청 — caller={}, requestedAt={}, category={}",
                caller, requestedAt, category == null ? "ALL" : category);
        GroupBetSettlementSummaryResponse summary = groupBetSettlementService.settleDueBets(category);
        log.warn("내기 정산 수동 트리거 완료 — caller={}, requestedAt={}, category={}, 대상={}, "
                        + "분배={}, 몰수={}, 스킵={}, 실패={}",
                caller, requestedAt, category == null ? "ALL" : category, summary.targetCount(),
                summary.settledCount(), summary.forfeitedCount(), summary.skippedCount(),
                summary.failedCount());
        return ResponseEntity.ok(summary);
    }

    /**
     * 감사 로그용 호출자 식별 — ALB/Nginx 뒤라 원격 주소만으로는 실제 발신지를 모르므로
     * {@code X-Forwarded-For} 를 함께 남긴다. 이 값은 위조 가능하다 — 인가는 어디까지나 관리자
     * 키가 하고, 이 필드는 사후 추적 단서일 뿐이다.
     */
    private static String callerOf(HttpServletRequest request) {
        if (request == null) {
            return "unknown";
        }
        String forwardedFor = request.getHeader("X-Forwarded-For");
        return forwardedFor == null || forwardedFor.isBlank()
                ? String.valueOf(request.getRemoteAddr())
                : request.getRemoteAddr() + " (xff=" + forwardedFor + ")";
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
