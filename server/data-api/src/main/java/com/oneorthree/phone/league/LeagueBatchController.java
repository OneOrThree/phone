package com.oneorthree.phone.league;

import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.service.LeagueBatchService;
import io.swagger.v3.oas.annotations.Parameter;
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
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;

/**
 * 운영/테스트용 수동 트리거 — 프로파일 게이팅으로 prod 미노출.
 * resume 은 프로파일에 더해 관리자 키(X-Batch-Admin-Key 헤더 ↔ 환경변수 BATCH_ADMIN_KEY)를
 * 요구한다(GroupBetBatchController 선례). 기존 run 은 409 가드가 사실상 주 1회로 막고 있고 키
 * 소급 부과는 기존 운영 절차(Apidog 등)를 깨는 계약 변화라 무키를 유지한다 — GROMO-1239 보고 참조.
 * TODO: 정식 관리자 권한(인증/인가) 설계는 별도 백로그 티켓
 * Swagger 애노테이션은 LeagueBatchControllerDocs 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@Profile({"local", "dev", "staging"})
public class LeagueBatchController implements LeagueBatchControllerDocs {

    /** 관리자 키 요청 헤더 — 환경변수 {@code BATCH_ADMIN_KEY} 값과 일치해야 한다. */
    public static final String ADMIN_KEY_HEADER = "X-Batch-Admin-Key";

    private final LeagueBatchService leagueBatchService;
    private final String batchAdminKey;

    /**
     * 키 미설정은 기동 실패가 아니라 503 응답으로 처리한다(GroupBetBatchController 와 같은 관행)
     * — 그래서 default 를 "" 로 둔다.
     */
    public LeagueBatchController(LeagueBatchService leagueBatchService,
                                 @Value("${BATCH_ADMIN_KEY:}") String batchAdminKey) {
        this.leagueBatchService = leagueBatchService;
        this.batchAdminKey = batchAdminKey;
    }

    @Override
    @PostMapping("/league/batch/run")
    public ResponseEntity<LeagueBatchSummaryResponse> runWeeklyBatch() {
        return ResponseEntity.ok(leagueBatchService.runWeeklyBatch());
    }

    @Override
    @PostMapping("/league/batch/resume")
    public ResponseEntity<LeagueBatchSummaryResponse> resumeWeeklyBatch(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey,
            @Parameter(description = "정산 대상 주차 시작 — KST 월요일 00:00 ISO instant (생략 시 직전 주차)")
            @RequestParam(required = false) String weekStartAt,
            @Parameter(description = "표적 정산할 유저 id 목록 (생략 시 전체 순회)")
            @RequestParam(required = false) List<UUID> userIds) {
        requireAdminKey(adminKey);
        return ResponseEntity.ok(
                leagueBatchService.resumeWeeklyBatch(Instant.now(), parseWeekStartAt(weekStartAt), userIds));
    }

    /**
     * 스프링 바인더 대신 직접 파싱 — 형식 오류를 프레임워크 400 이 아니라 INVALID_WEEK_START 로
     * 통일해 운영자가 월요일 경계 오류와 같은 문구 축에서 원인을 읽게 한다.
     */
    private Instant parseWeekStartAt(String weekStartAt) {
        if (weekStartAt == null || weekStartAt.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(weekStartAt);
        } catch (DateTimeParseException e) {
            throw new LeagueException(LeagueErrorCode.INVALID_WEEK_START);
        }
    }

    /**
     * 비교는 MessageDigest.isEqual — String.equals 는 첫 불일치 문자에서 끊겨 응답 시간으로
     * 키가 새는 이론적 여지가 있어 상수 시간 비교를 쓴다(GroupBetBatchController 와 동일).
     */
    private void requireAdminKey(String provided) {
        if (batchAdminKey.isBlank()) {
            throw new LeagueException(LeagueErrorCode.BATCH_KEY_NOT_CONFIGURED);
        }
        byte[] expected = batchAdminKey.getBytes(StandardCharsets.UTF_8);
        byte[] actual = provided == null ? new byte[0] : provided.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, actual)) {
            throw new LeagueException(LeagueErrorCode.BATCH_KEY_INVALID);
        }
    }
}
