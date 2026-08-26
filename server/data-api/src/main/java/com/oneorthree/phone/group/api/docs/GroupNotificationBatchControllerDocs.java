package com.oneorthree.phone.group.api.docs;

import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

/**
 * {@code GroupNotificationBatchController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "group-notification-batch",
        description = "그룹 챌린지 푸시 수동 트리거 (local/dev/staging 전용)")
public interface GroupNotificationBatchControllerDocs {

    @Operation(summary = "내기 사건 알림 재훑기 수동 실행",
            description = "최근 48시간 안에 종료된 회차(SETTLED·FORFEITED 결과 + VOIDED·REFUNDED 환불 통지)를"
                    + " 재훑기해 미발송 건을 사건 단위 파이프라인(클레임 → 묶음 → 발송)에 태우고,"
                    + " 조용한 시간 이월(DEFERRED) 건도 함께 흘려보낸다."
                    + " 크론과 달리 <슬롯이 닫히기를 기다리지 않고> 지금 있는 클레임을 즉시 발송한다"
                    + " — 방금 종료된 회차도 이 호출 한 번으로 발송까지 확인된다."
                    + " 이미 클레임된 (유저, kind, 회차) 사건은 dedup 으로 빠지므로 반복 호출해도 중복 발송이 없다"
                    + " (재호출 시 sentCount=0, dedupedCount>0 이 정상)."
                    + " X-Batch-Admin-Key 헤더에 관리자 키(환경변수 BATCH_ADMIN_KEY)를 실어야 한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "실행 성공(대상 0건 포함)"),
        @ApiResponse(responseCode = "403", description = "관리자 키 누락/불일치 (BATCH_KEY_INVALID)"),
        @ApiResponse(responseCode = "503", description = "서버에 관리자 키 미설정 (BATCH_KEY_NOT_CONFIGURED)")
    })
    ResponseEntity<PushDispatchSummaryResponse> notifyBetResults(String adminKey);

    @Operation(summary = "챌린지 창 종료 푸시 수동 실행",
            description = "창형(TIME_WINDOW) 활성 챌린지 중 오늘 창 종료가"
                    + " 최근 30분 안에 지난 건을 찾아 그룹원 전원에게 '결과 확인' 푸시를 보낸다(승패 미포함)."
                    + " 창 종료 직후가 아니면 대상 0건이 정상이다 — 아무 때나 발송시키는 트리거가 아니라"
                    + " 15분 크론과 같은 판정을 즉시 돌려보는 트리거다."
                    + " 같은 날 같은 챌린지는 유저당 1회만 나간다(dedup)."
                    + " X-Batch-Admin-Key 헤더에 관리자 키(환경변수 BATCH_ADMIN_KEY)를 실어야 한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "실행 성공(대상 0건 포함)"),
        @ApiResponse(responseCode = "403", description = "관리자 키 누락/불일치 (BATCH_KEY_INVALID)"),
        @ApiResponse(responseCode = "503", description = "서버에 관리자 키 미설정 (BATCH_KEY_NOT_CONFIGURED)")
    })
    ResponseEntity<PushDispatchSummaryResponse> notifyChallengeWindowEnd(String adminKey);

    @Operation(summary = "일 목표형 챌린지 하루 마감 푸시 수동 실행",
            description = "일 목표형(DURATION) 활성 챌린지의 그룹원에게 '어제 결과 확인' 푸시를 보낸다"
                    + " (승패 미포함). 스케줄러 09:00 KST 잡과 같은 판정이며, 회차 경계가 자정이라"
                    + " 호출 시각의 KST 날짜 기준 '어제' 회차가 대상이다."
                    + " 같은 회차는 유저당 1회만 나간다(dedup) — 재호출 시 sentCount=0, dedupedCount>0 이 정상."
                    + " 한 그룹에 마감된 챌린지가 여러 건이어도 푸시는 그룹당 1건이다."
                    + " X-Batch-Admin-Key 헤더에 관리자 키(환경변수 BATCH_ADMIN_KEY)를 실어야 한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "실행 성공(대상 0건 포함)"),
        @ApiResponse(responseCode = "403", description = "관리자 키 누락/불일치 (BATCH_KEY_INVALID)"),
        @ApiResponse(responseCode = "503", description = "서버에 관리자 키 미설정 (BATCH_KEY_NOT_CONFIGURED)")
    })
    ResponseEntity<PushDispatchSummaryResponse> notifyChallengeDurationEnd(String adminKey);
}
