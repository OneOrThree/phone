package com.oneorthree.phone.notification.api;

import com.oneorthree.phone.notification.service.InactiveReturnNotificationService;
import com.oneorthree.phone.notification.service.LeagueNotificationService;
import com.oneorthree.phone.notification.service.RankOvertakeNotificationService;
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

/**
 * 알림 수동 트리거 (GROMO-528) — QA/운영 검증용, prod 미노출(LeagueBatchController 선례).
 * 정식 관리자 권한은 백로그(티켓 566).
 */
@Tag(name = "notification-batch", description = "알림 배치 수동 트리거 (local/dev/staging 전용)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
// prod 만 제외 — ci 포함은 OpenAPI 문서 생성(generateOpenApiDocs)이 ci 프로파일로 부팅하기 때문.
// ci 를 빼면 이 엔드포인트가 스펙에서 누락돼 Apidog 에 안 올라온다 (런타임 노출 아님, prod 미노출 유지).
@Profile({"local", "ci", "dev", "staging"})
public class NotificationBatchController {

    private final LeagueNotificationService leagueNotificationService;
    private final InactiveReturnNotificationService inactiveReturnNotificationService;
    private final RankOvertakeNotificationService rankOvertakeNotificationService;

    @Operation(summary = "주간 리그 결과 알림 수동 실행",
            description = "직전 주차 승격/강등 유저에게 즉시 발송. "
                    + "⚠️ 상태 재조회 방식이라 재트리거 시 같은 유저에게 중복 발송됨 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    @PostMapping("/notifications/league/results/run")
    public ResponseEntity<Void> runWeeklyResultNotifications() {
        leagueNotificationService.sendWeeklyResultNotifications();
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "리그 마감 임박 알림 수동 실행",
            description = "ACTIVE 아레나 참가자 전원에게 현재 순위 포함 즉시 발송. 재트리거 시 중복 발송 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    @PostMapping("/notifications/league/deadline/run")
    public ResponseEntity<Void> runDeadlineReminders() {
        leagueNotificationService.sendDeadlineReminders();
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "미접속 복귀 푸시 수동 실행",
            description = "last_active_at 기준 D+3/7/14 정확히 N일째 유저에게 단계별 문구로 즉시 발송. "
                    + "⚠️ Dedup 미적용 — 같은 날 재트리거 시 중복 발송될 수 있음(운영 주의).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    @PostMapping("/notifications/inactive-return/run")
    public ResponseEntity<Void> runInactiveReturnNotifications() {
        inactiveReturnNotificationService.sendInactiveReturnNotifications();
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "순위 추월 푸시 수동 실행",
            description = "어제 스냅샷과 오늘 실시간 순위를 비교해 나를 제친 라이벌 1건(묶음) 발송 후 오늘 스냅샷 저장. "
                    + "억제(최하위·오늘접속·오늘집중·마감임박·48h쿨다운·주2회) 통과 건만 발송. "
                    + "⚠️ 스냅샷을 진행시키므로 같은 날 재트리거하면 오늘 스냅샷이 갱신됨 — 비교 기준 이동 주의(운영).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    @PostMapping("/notifications/rank-overtake/run")
    public ResponseEntity<Void> runRankOvertakeNotifications() {
        rankOvertakeNotificationService.sendRankOvertakeNotifications();
        return ResponseEntity.noContent().build();
    }
}
