package com.oneorthree.phone.notification.api;

import com.oneorthree.phone.notification.api.docs.NotificationBatchControllerDocs;
import com.oneorthree.phone.notification.service.InactiveReturnNotificationService;
import com.oneorthree.phone.notification.service.LeagueNotificationService;
import com.oneorthree.phone.notification.service.RankOvertakeNotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 알림 수동 트리거 (GROMO-528) — QA/운영 검증용, prod 미노출(LeagueBatchController 선례).
 * 정식 관리자 권한은 백로그(티켓 566).
 *
 * <p>Swagger 애노테이션은 {@link NotificationBatchControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
/**
 * prod 만 제외 — ci 포함은 OpenAPI 문서 생성(generateOpenApiDocs)이 ci 프로파일로 부팅하기 때문.
 * ci 를 빼면 이 엔드포인트가 스펙에서 누락돼 Apidog 에 안 올라온다 (런타임 노출 아님, prod 미노출 유지).
 */
@Profile({"local", "ci", "dev", "staging"})
public class NotificationBatchController implements NotificationBatchControllerDocs {

    private final LeagueNotificationService leagueNotificationService;
    private final InactiveReturnNotificationService inactiveReturnNotificationService;
    private final RankOvertakeNotificationService rankOvertakeNotificationService;

    @Override
    @PostMapping("/notifications/league/results/run")
    public ResponseEntity<Void> runWeeklyResultNotifications() {
        leagueNotificationService.sendWeeklyResultNotifications();
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/notifications/league/deadline/run")
    public ResponseEntity<Void> runDeadlineReminders() {
        leagueNotificationService.sendDeadlineReminders();
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/notifications/league/crisis/run")
    public ResponseEntity<Void> runSundayCrisisReminders() {
        leagueNotificationService.sendSundayCrisisReminders();
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/notifications/league/relegation-warning/run")
    public ResponseEntity<Void> runRelegationWarnings() {
        leagueNotificationService.sendRelegationWarnings();
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/notifications/league/final-deadline/run")
    public ResponseEntity<Void> runFinalDeadlineReminders() {
        leagueNotificationService.sendFinalDeadlineReminders();
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/notifications/inactive-return/run")
    public ResponseEntity<Void> runInactiveReturnNotifications() {
        inactiveReturnNotificationService.sendInactiveReturnNotifications();
        return ResponseEntity.noContent().build();
    }

    @Override
    @PostMapping("/notifications/rank-overtake/run")
    public ResponseEntity<Void> runRankOvertakeNotifications() {
        rankOvertakeNotificationService.sendRankOvertakeNotifications();
        return ResponseEntity.noContent().build();
    }
}
