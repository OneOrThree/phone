package com.oneorthree.phone.internal.notification;

import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityRequest;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import com.oneorthree.phone.internal.notification.dto.NotificationSnapshotPageResponse;
import com.oneorthree.phone.internal.notification.dto.ResultAckStateResponse;
import com.oneorthree.phone.internal.notification.service.NotificationEligibilityService;
import com.oneorthree.phone.internal.notification.service.NotificationSnapshotService;
import com.oneorthree.phone.group.service.ChallengeResultAckService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;
import java.time.Instant;

/**
 * 알림 서버 → Data 조회 표면 — <b>세 종류뿐이다</b> (계약 §2 · A22).
 *
 * <h2>왜 세 종류로 못 박는가</h2>
 * 후보 탐색·정산·회계용 코어 조회를 하나씩 더하다 보면 알림 서버가 사실상 코어 DB 를 읽는 상태가
 * 되고, 그때는 DB 를 나눈 의미가 남지 않는다. 그래서 <b>개수가 계약</b>이다.
 * <ol>
 *   <li>{@code GET /internal/users/notification-snapshot} — 투영 부트스트랩(여기)</li>
 *   <li>{@code GET /internal/users/{userId}/result-ack} — 정본 ack 조회(여기). 호출자가 Business 가
 *       아니라 알림 서버라 {@code InternalChallengeResultController}(선점·확인, 호출자는 Business)와
 *       나눠 둔다. 읽기 로직 자체는 {@code ChallengeResultAckService.readAckState} 하나뿐이라
 *       「행이 없을 때」의 처리가 두 곳에서 갈리지 않는다</li>
 *   <li>{@code POST /internal/notifications/eligibility} — 발송 직전 상태 재확인(여기)</li>
 * </ol>
 *
 * <h2>인증은 이 클래스가 하지 않는다</h2>
 * {@code InternalAuthFilter} 가 caller 별 서비스 토큰과 <b>METHOD + 경로 허용목록</b>으로 이미 걸렀다
 * (㉱). 여기서 또 검사하면 두 곳이 서로 다르게 판단할 여지가 생긴다.
 *
 * <h2>스냅샷에 {@code X-User-Id} 가 없다</h2>
 * 경로가 {@code /internal/users/} 로 시작하지만 <b>대상 유저가 없는</b> 전수 조회다. 필터의
 * 「경로의 유저 ≠ 헤더의 주체」 검사는 경로 segment 가 UUID 일 때만 걸리므로
 * ({@code notification-snapshot} 은 UUID 가 아니다) 통과한다 — 우연이 아니라 필터가 그렇게 설계돼 있다.
 */
@RestController
@RequiredArgsConstructor
public class InternalNotificationController {

    private final NotificationSnapshotService notificationSnapshotService;
    private final NotificationEligibilityService notificationEligibilityService;
    private final ChallengeResultAckService challengeResultAckService;

    /**
     * 유저 투영 스냅샷 한 페이지.
     *
     * @param cursor 직전 페이지의 {@code nextCursor}. 처음이면 생략
     * @param limit  페이지 크기. 생략하면 기본값, 상한을 넘기면 상한으로 접는다
     * @return {@code {items, nextCursor}} — {@code nextCursor} 가 {@code null} 이면 끝이다
     */
    @GetMapping("/internal/users/notification-snapshot")
    public ResponseEntity<NotificationSnapshotPageResponse> readSnapshot(
            @RequestParam(required = false) UUID cursor,
            @RequestParam(required = false) Integer limit) {

        return ResponseEntity.ok(notificationSnapshotService.read(cursor, limit));
    }

    /**
     * 정본 ack 조회 — 알림 서버가 {@code NEEDS_CONFIRM} 에서 빠져나오는 길이다.
     *
     * <p>⚠️ <b>행이 없어도 404 가 아니다.</b> 「미확인」과 「참가 행 없음」은 억제를 푸는 쪽에서
     * 결론이 같고, 404 를 던지면 수렴 경로가 그 예외에 막힌다.
     *
     * <p>경로의 {@code userId} 와 {@code X-User-Id} 헤더가 다르면 {@code InternalAuthFilter} 가
     * 이미 403 으로 막았다 — 여기서 다시 대조하지 않는다.
     *
     * @param userId    대상 유저
     * @param sessionId 회차
     * @return {@code {acknowledged, acknowledgedAt}}
     */
    @GetMapping("/internal/users/{userId}/result-ack")
    public ResponseEntity<ResultAckStateResponse> readResultAck(
            @PathVariable UUID userId, @RequestParam UUID sessionId, @RequestParam Instant ackDeadlineAt) {

        ChallengeResultAckService.ResultAckState state =
                challengeResultAckService.readAckState(userId, sessionId, ackDeadlineAt);
        return ResponseEntity.ok(
                new ResultAckStateResponse(state.acknowledged(), state.acknowledgedAt()));
    }

    /**
     * 발송 직전 상태 재확인.
     *
     * <p>⚠️ 조회 실패를 {@code eligible=false} 로 접지 않는다 — 예외는 그대로 5xx 로 나간다. 장애를
     * 「정책상 안 보냄」으로 둔갑시키면 그 동안의 알림이 통째로 사라지고 되짚을 근거도 남지 않는다.
     *
     * @param request 수신자·종류·대상·추가 판정 입력
     * @return {@code {eligible, reason}} — 거절이면 사유 코드가 실린다
     */
    @PostMapping("/internal/notifications/eligibility")
    public ResponseEntity<NotificationEligibilityResponse> evaluateEligibility(
            @Valid @RequestBody NotificationEligibilityRequest request) {

        return ResponseEntity.ok(notificationEligibilityService.evaluate(request));
    }
}
