package com.oneorthree.phone.group.api;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import com.oneorthree.phone.notification.service.ChallengeDurationEndNotificationService;
import com.oneorthree.phone.notification.service.ChallengeWindowEndNotificationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * 그룹 챌린지 푸시 수동 트리거(B4) — QA/운영 검증용, prod 미노출.
 *
 * <p>{@link GroupBetBatchController} 와 같은 관행이다: 프로파일 게이팅 + 관리자 키
 * ({@code X-Batch-Admin-Key} ↔ 환경변수 {@code BATCH_ADMIN_KEY}). 이 엔드포인트들은 실제 FCM
 * 발송을 일으키므로(유저 단말에 알림이 뜬다) 정산 트리거와 같은 수준으로 잠근다.
 *
 * <p>어느 트리거도 dedup 을 우회하지 않는다 — 재호출하면 sentCount 0 / dedupedCount 로 잡히는 것이
 * 정상이며, 그것이 dedup 이 살아 있다는 QA 확인 지점이다.
 */
@Tag(name = "group-notification-batch",
        description = "그룹 챌린지 푸시 수동 트리거 (local/dev/staging 전용)")
@RestController
@RequestMapping("/api/v1")
@Profile({"local", "dev", "staging"})
public class GroupNotificationBatchController {

    /** 관리자 키 요청 헤더 — 환경변수 {@code BATCH_ADMIN_KEY} 값과 일치해야 한다. */
    public static final String ADMIN_KEY_HEADER = GroupBetBatchController.ADMIN_KEY_HEADER;

    private final BetEventNotificationService betEventNotificationService;
    private final ChallengeWindowEndNotificationService challengeWindowEndNotificationService;
    private final ChallengeDurationEndNotificationService challengeDurationEndNotificationService;
    private final String batchAdminKey;

    // 키 미설정은 기동 실패가 아니라 503 응답으로 처리한다(GroupBetBatchController 와 동일).
    public GroupNotificationBatchController(
            BetEventNotificationService betEventNotificationService,
            ChallengeWindowEndNotificationService challengeWindowEndNotificationService,
            ChallengeDurationEndNotificationService challengeDurationEndNotificationService,
            @Value("${BATCH_ADMIN_KEY:}") String batchAdminKey) {
        this.betEventNotificationService = betEventNotificationService;
        this.challengeWindowEndNotificationService = challengeWindowEndNotificationService;
        this.challengeDurationEndNotificationService = challengeDurationEndNotificationService;
        this.batchAdminKey = batchAdminKey;
    }

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
    @PostMapping("/groups/bets/notify-results")
    public ResponseEntity<PushDispatchSummaryResponse> notifyBetResults(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey) {
        requireAdminKey(adminKey);
        return ResponseEntity.ok(betEventNotificationService.rescanAndFlushImmediately());
    }

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
    @PostMapping("/groups/challenges/notify-window-end")
    public ResponseEntity<PushDispatchSummaryResponse> notifyChallengeWindowEnd(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey) {
        requireAdminKey(adminKey);
        return ResponseEntity.ok(challengeWindowEndNotificationService.sendWindowEndNotifications());
    }

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
    @PostMapping("/groups/challenges/notify-duration-end")
    public ResponseEntity<PushDispatchSummaryResponse> notifyChallengeDurationEnd(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey) {
        requireAdminKey(adminKey);
        return ResponseEntity.ok(challengeDurationEndNotificationService.sendDurationEndNotifications());
    }

    // 상수 시간 비교 — String.equals 는 첫 불일치에서 끊겨 응답 시간으로 키가 새는 여지가 있다
    // (GroupBetBatchController 와 같은 구현·같은 에러코드).
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
