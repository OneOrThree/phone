package com.oneorthree.phone.notification.api.docs;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

/**
 * {@code NotificationBatchController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "notification-batch", description = "알림 배치 수동 트리거 (local/dev/staging 전용)")
public interface NotificationBatchControllerDocs {

    @Operation(summary = "주간 리그 결과 알림 수동 실행",
            description = "직전 주차 승격/강등 유저에게 즉시 발송. "
                    + "⚠️ 상태 재조회 방식이라 재트리거 시 같은 유저에게 중복 발송됨 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runWeeklyResultNotifications();

    @Operation(summary = "리그 마감 임박 알림 수동 실행",
            description = "ACTIVE 아레나 참가자 전원에게 현재 순위 포함 즉시 발송. 재트리거 시 중복 발송 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runDeadlineReminders();

    @Operation(summary = "리그 위기 알림(강등 경고 + 마감 D-1) 수동 실행",
            description = "스케줄러 일 09:00 KST 잡과 동일 — 전역 랭킹 전원 대상, 유저당 1건 분기(강등 경고 우선). "
                    + "재트리거 시 중복 발송 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runSundayCrisisReminders();

    @Operation(summary = "리그 강등 경고 재발송 수동 실행",
            description = "스케줄러 일 18:00 KST 잡과 동일 — 강등 위험군만 재발송(마감 D-1 제외). "
                    + "재트리거 시 중복 발송 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runRelegationWarnings();

    @Operation(summary = "리그 마감 2시간 전 알림 수동 실행",
            description = "스케줄러 일 22:00 KST 잡과 동일 — 진행 중 전원에게 현재 순위 포함 발송. "
                    + "재트리거 시 중복 발송 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runFinalDeadlineReminders();

    @Operation(summary = "미접속 복귀 푸시 수동 실행",
            description = "last_active_at 기준 D+3/7/14 정확히 N일째 유저에게 단계별 문구로 즉시 발송. "
                    + "⚠️ Dedup 미적용 — 같은 날 재트리거 시 중복 발송될 수 있음(운영 주의).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runInactiveReturnNotifications();

    @Operation(summary = "순위 추월 푸시 수동 실행",
            description = "어제 스냅샷과 오늘 실시간 순위를 비교해 나를 제친 라이벌 1건(묶음) 발송 후 오늘 스냅샷 저장. "
                    + "억제(최하위·오늘접속·오늘집중·마감임박·48h쿨다운·주2회) 통과 건만 발송. "
                    + "⚠️ 스냅샷을 진행시키므로 같은 날 재트리거하면 오늘 스냅샷이 갱신됨 — 비교 기준 이동 주의(운영).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runRankOvertakeNotifications();
}
