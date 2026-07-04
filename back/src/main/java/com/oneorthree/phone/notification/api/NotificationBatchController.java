package com.oneorthree.phone.notification.api;

import com.oneorthree.phone.notification.service.LeagueNotificationService;
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
@Profile({"local", "dev", "staging"})
public class NotificationBatchController {

    private final LeagueNotificationService leagueNotificationService;

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
}
