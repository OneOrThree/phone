package com.oneorthree.phone.league.api;

import com.oneorthree.phone.league.dto.LeagueBatchSummaryResponse;
import com.oneorthree.phone.league.exception.LeagueErrorCode;
import com.oneorthree.phone.league.exception.LeagueException;
import com.oneorthree.phone.league.service.LeagueBatchService;
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
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;

// 운영/테스트용 수동 트리거 — 프로파일 게이팅으로 prod 미노출.
// resume 은 프로파일에 더해 관리자 키(X-Batch-Admin-Key 헤더 ↔ 환경변수 BATCH_ADMIN_KEY)를
// 요구한다(GroupBetBatchController 선례). 기존 run 은 409 가드가 사실상 주 1회로 막고 있고 키
// 소급 부과는 기존 운영 절차(Apidog 등)를 깨는 계약 변화라 무키를 유지한다 — GROMO-1239 보고 참조.
// TODO: 정식 관리자 권한(인증/인가) 설계는 별도 백로그 티켓
@Tag(name = "league-batch", description = "리그 주간 배치 수동 트리거 (local/dev/staging 전용)")
@RestController
@RequestMapping("/api/v1")
@Profile({"local", "dev", "staging"})
public class LeagueBatchController {

    /** 관리자 키 요청 헤더 — 환경변수 {@code BATCH_ADMIN_KEY} 값과 일치해야 한다. */
    public static final String ADMIN_KEY_HEADER = "X-Batch-Admin-Key";

    private final LeagueBatchService leagueBatchService;
    private final String batchAdminKey;

    // 키 미설정은 기동 실패가 아니라 503 응답으로 처리한다(GroupBetBatchController 와 같은 관행)
    // — 그래서 default 를 "" 로 둔다.
    public LeagueBatchController(LeagueBatchService leagueBatchService,
                                 @Value("${BATCH_ADMIN_KEY:}") String batchAdminKey) {
        this.leagueBatchService = leagueBatchService;
        this.batchAdminKey = batchAdminKey;
    }

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
    @PostMapping("/league/batch/run")
    public ResponseEntity<LeagueBatchSummaryResponse> runWeeklyBatch() {
        return ResponseEntity.ok(leagueBatchService.runWeeklyBatch());
    }

    @Operation(summary = "리그 주간 배치 재개(멱등 재실행 — 회전 없음)",
            description = "크래시·부분 실패로 남은 미정산 유저를 마저 정산한다(GROMO-1239). 절대 "
                    + "회전하지 않는다 — 대상 주차 run 이 커밋한 가드 anchor(주차 종료 경계 시각)가 "
                    + "없으면 409(BATCH_NOT_RUN)로 거부하니 최초 실행은 /league/batch/run 을 쓴다. "
                    + "기정산 유저는 완료 마커(league_weekly_results 유니크 행) 기준 "
                    + "alreadySettledMemberCount 로 건너뛴다 — 티어 재적용·보너스 이중 지급 없이 몇 "
                    + "번을 호출해도 안전하다(멱등). 두 모드: ① weekStartAt 생략 = 호출 시각 기준 "
                    + "직전 KST 주차 재개, ② weekStartAt 지정(정산 대상 주차의 KST 월요일 00:00 "
                    + "ISO instant, 예: 2026-08-02T15:00:00Z) = 다음 주차가 이미 회전한 뒤에도 그 "
                    + "과거 주차를 복구. 주차 종료 후 가입한 유저는 대상에서 제외된다(가입 컷오프). "
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

    // 스프링 바인더 대신 직접 파싱 — 형식 오류를 프레임워크 400 이 아니라 INVALID_WEEK_START 로
    // 통일해 운영자가 월요일 경계 오류와 같은 문구 축에서 원인을 읽게 한다.
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

    // 비교는 MessageDigest.isEqual — String.equals 는 첫 불일치 문자에서 끊겨 응답 시간으로
    // 키가 새는 이론적 여지가 있어 상수 시간 비교를 쓴다(GroupBetBatchController 와 동일).
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
