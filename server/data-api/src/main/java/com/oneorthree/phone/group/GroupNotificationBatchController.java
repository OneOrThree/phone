package com.oneorthree.phone.group;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.notification.dto.PushDispatchSummaryResponse;
import com.oneorthree.phone.notification.service.BetEventNotificationService;
import com.oneorthree.phone.notification.service.ChallengeDurationEndNotificationService;
import com.oneorthree.phone.notification.service.ChallengeWindowEndNotificationService;
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
 *
 * <p>Swagger 애노테이션은 {@link GroupNotificationBatchControllerDocs} 로 분리했다(GROMO-1621).
 */
@RestController
@RequestMapping("/api/v1")
@Profile({"local", "dev", "staging"})
public class GroupNotificationBatchController implements GroupNotificationBatchControllerDocs {

    /** 관리자 키 요청 헤더 — 환경변수 {@code BATCH_ADMIN_KEY} 값과 일치해야 한다. */
    public static final String ADMIN_KEY_HEADER = GroupBetBatchController.ADMIN_KEY_HEADER;

    private final BetEventNotificationService betEventNotificationService;
    private final ChallengeWindowEndNotificationService challengeWindowEndNotificationService;
    private final ChallengeDurationEndNotificationService challengeDurationEndNotificationService;
    private final String batchAdminKey;

    /**
     * 키 미설정은 기동 실패가 아니라 503 응답으로 처리한다(GroupBetBatchController 와 동일).
      *
      * @param betEventNotificationService 내기 사건 알림 재훑기 — dedup 은 이쪽이 진다
      * @param challengeWindowEndNotificationService 창형 챌린지 창 종료 푸시
      * @param challengeDurationEndNotificationService 하루형 챌린지 마감 푸시
      * @param batchAdminKey 환경변수에서 주입되는 관리자 키. 빈 문자열이면 세 엔드포인트가 전부 503 이다
     */
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

    @Override
    @PostMapping("/groups/bets/notify-results")
    public ResponseEntity<PushDispatchSummaryResponse> notifyBetResults(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey) {
        requireAdminKey(adminKey);
        return ResponseEntity.ok(betEventNotificationService.rescanAndFlushImmediately());
    }

    @Override
    @PostMapping("/groups/challenges/notify-window-end")
    public ResponseEntity<PushDispatchSummaryResponse> notifyChallengeWindowEnd(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey) {
        requireAdminKey(adminKey);
        return ResponseEntity.ok(challengeWindowEndNotificationService.sendWindowEndNotifications());
    }

    @Override
    @PostMapping("/groups/challenges/notify-duration-end")
    public ResponseEntity<PushDispatchSummaryResponse> notifyChallengeDurationEnd(
            @RequestHeader(value = ADMIN_KEY_HEADER, required = false) String adminKey) {
        requireAdminKey(adminKey);
        return ResponseEntity.ok(challengeDurationEndNotificationService.sendDurationEndNotifications());
    }

    /**
     * 상수 시간 비교 — String.equals 는 첫 불일치에서 끊겨 응답 시간으로 키가 새는 여지가 있다
     * (GroupBetBatchController 와 같은 구현·같은 에러코드).
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
