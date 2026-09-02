package com.oneorthree.phone.notification;

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

    /**
     * 직전 주차 승격·강등 결과를 대상자에게 발송한다.
     *
     * @return 본문 없는 204. 발송 건수는 응답이 아니라 서버 로그로만 확인하며,
     *         중복 발송을 막는 장치가 없어 다시 부르면 같은 유저가 또 받는다
     */
    @Operation(summary = "주간 리그 결과 알림 수동 실행",
            description = "직전 주차 승격/강등 유저에게 즉시 발송. "
                    + "⚠️ 상태 재조회 방식이라 재트리거 시 같은 유저에게 중복 발송됨 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runWeeklyResultNotifications();

    /**
     * 진행 중 아레나 참가자 전원에게 현재 순위를 담아 마감 임박을 알린다.
     *
     * @return 본문 없는 204. 중복 발송 방지가 없어 재실행하면 같은 유저가 다시 받는다
     */
    @Operation(summary = "리그 마감 임박 알림 수동 실행",
            description = "ACTIVE 아레나 참가자 전원에게 현재 순위 포함 즉시 발송. 재트리거 시 중복 발송 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runDeadlineReminders();

    /**
     * 일요일 위기 알림(강등 경고 · 마감 D-1)을 스케줄러와 같은 규칙으로 발송한다.
     * 한 유저가 두 조건에 다 걸려도 강등 경고 한 건만 간다.
     *
     * @return 본문 없는 204. 중복 발송 방지가 없어 재실행하면 같은 유저가 다시 받는다
     */
    @Operation(summary = "리그 위기 알림(강등 경고 + 마감 D-1) 수동 실행",
            description = "스케줄러 일 09:00 KST 잡과 동일 — 전역 랭킹 전원 대상, 유저당 1건 분기(강등 경고 우선). "
                    + "재트리거 시 중복 발송 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runSundayCrisisReminders();

    /**
     * 강등 위험군에만 경고를 다시 보낸다 — 마감 D-1 대상은 여기서 빠진다.
     *
     * @return 본문 없는 204. 중복 발송 방지가 없어 재실행하면 같은 유저가 다시 받는다
     */
    @Operation(summary = "리그 강등 경고 재발송 수동 실행",
            description = "스케줄러 일 18:00 KST 잡과 동일 — 강등 위험군만 재발송(마감 D-1 제외). "
                    + "재트리거 시 중복 발송 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runRelegationWarnings();

    /**
     * 마감 2시간 전 알림을 진행 중 참가자 전원에게 현재 순위와 함께 보낸다.
     *
     * @return 본문 없는 204. 중복 발송 방지가 없어 재실행하면 같은 유저가 다시 받는다
     */
    @Operation(summary = "리그 마감 2시간 전 알림 수동 실행",
            description = "스케줄러 일 22:00 KST 잡과 동일 — 진행 중 전원에게 현재 순위 포함 발송. "
                    + "재트리거 시 중복 발송 — 운영 주의.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runFinalDeadlineReminders();

    /**
     * 마지막 접속으로부터 정확히 D+3·7·14 일째인 유저에게 단계별 복귀 문구를 보낸다.
     *
     * @return 본문 없는 204. 발송 이력을 남기지 않아 같은 날 다시 부르면 중복 발송된다
     */
    @Operation(summary = "미접속 복귀 푸시 수동 실행",
            description = "last_active_at 기준 D+3/7/14 정확히 N일째 유저에게 단계별 문구로 즉시 발송. "
                    + "⚠️ Dedup 미적용 — 같은 날 재트리거 시 중복 발송될 수 있음(운영 주의).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runInactiveReturnNotifications();

    /**
     * 어제 스냅샷과 지금 순위를 비교해 나를 제친 라이벌을 한 건으로 묶어 알린다.
     *
     * <p>다른 배치와 달리 <b>비교 기준이 되는 스냅샷을 앞으로 밀어 놓는다</b> — 같은 날 다시 부르면
     * 오늘 스냅샷이 갱신돼 이후 비교 기준 자체가 달라진다.
     *
     * @return 본문 없는 204. 억제 조건(최하위·오늘 접속·오늘 집중·마감 임박·쿨다운·주 2회)에
     *         걸린 유저는 발송에서 빠진다
     */
    @Operation(summary = "순위 추월 푸시 수동 실행",
            description = "어제 스냅샷과 오늘 실시간 순위를 비교해 나를 제친 라이벌 1건(묶음) 발송 후 오늘 스냅샷 저장. "
                    + "억제(최하위·오늘접속·오늘집중·마감임박·48h쿨다운·주2회) 통과 건만 발송. "
                    + "⚠️ 스냅샷을 진행시키므로 같은 날 재트리거하면 오늘 스냅샷이 갱신됨 — 비교 기준 이동 주의(운영).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "실행 완료 (발송 건수는 서버 로그 참조)")
    })
    ResponseEntity<Void> runRankOvertakeNotifications();
}
