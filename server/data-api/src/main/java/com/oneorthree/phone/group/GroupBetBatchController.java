package com.oneorthree.phone.group;

import io.swagger.v3.oas.annotations.Parameter;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.dto.GroupBetSettlementSummaryResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.service.GroupBetSettlementService;
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

/**
 * 운영 수동 트리거(MANUAL) — LLD §2.3: 정산 트리거는 <b>prod 포함</b> 전 환경에 연다. 24h 자동
 * 환불이 최후 방어선이지만 그 전에 손으로 풀 수단이 있어야 한다(스케줄러 장애 복구가 정확히 그
 * 상황이다). 종전 @Profile({"local","dev","staging"}) 게이팅은 그 복구 경로를 prod 에서 막고
 * 있었다(GROMO-1411 후속). 인가는 관리자 키(X-Batch-Admin-Key 헤더 ↔ 환경변수 BATCH_ADMIN_KEY)
 * 가 계속 진다 — 키 미설정 503 · 불일치 403 · 상수 시간 비교. 감사 로그(§2.3 필수): 호출 시각은
 * 로그 타임스탬프, 호출자는 관리자 키 단일 주체(개인 식별 축 없음 — 키 소지 = 운영자), 대상
 * 회차·결과는 아래 warn 요약 + 회차별 정산 로그(GroupBetSettler)가 남긴다.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1")
public class GroupBetBatchController implements GroupBetBatchControllerDocs {

    /** 관리자 키 요청 헤더 — 환경변수 {@code BATCH_ADMIN_KEY} 값과 일치해야 한다. */
    public static final String ADMIN_KEY_HEADER = "X-Batch-Admin-Key";

    private final GroupBetSettlementService groupBetSettlementService;
    private final String batchAdminKey;

    /**
     * 키 미설정은 기동 실패가 아니라 503 응답으로 처리한다(스펙) — 그래서 default 를 "" 로 둔다.
      *
      * @param groupBetSettlementService 정산 본체 — 그레이스·데드라인 가드는 전부 이쪽이 진다
      * @param batchAdminKey 환경변수에서 주입되는 관리자 키. 빈 문자열이면 이 엔드포인트가 503 만 돌려준다
     */
    public GroupBetBatchController(GroupBetSettlementService groupBetSettlementService,
                                   @Value("${BATCH_ADMIN_KEY:}") String batchAdminKey) {
        this.groupBetSettlementService = groupBetSettlementService;
        this.batchAdminKey = batchAdminKey;
    }

    /**
     * 정산 대기 회차를 지금 훑는다 — 스케줄러 장애를 손으로 푸는 복구 경로다.
     *
     * <p>호출 사실·대상·결과를 warn 으로 남긴다(감사 로그). 조기 정산 사고가 없도록 그레이스
     * 가드는 정산 본체가 지므로 아무 시각에나 불러도 안전하고, 이미 정산된 회차는 스킵돼
     * 이중 지급이 없다.
     *
     * @param adminKey 관리자 키 헤더 — 서버에 키가 없으면 503, 틀리면 403(상수 시간 비교)
     * @param category 대상 카테고리 — 생략하면 전 카테고리다
     * @return 대상·분배·몰수·환불·스킵·실패 건수 요약. 실패 건은 그 회차만 롤백되고 나머지는 진행된다
     */
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

    /**
     * 비교는 MessageDigest.isEqual — String.equals 는 첫 불일치 문자에서 끊겨 응답 시간으로
     * 키가 새는 이론적 여지가 있어 상수 시간 비교를 쓴다.
     */
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
