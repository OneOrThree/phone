package com.oneorthree.phone.internal.notification;

import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityRequest;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import com.oneorthree.phone.internal.notification.dto.NotificationSnapshotPageResponse;
import com.oneorthree.phone.internal.notification.service.NotificationEligibilityService;
import com.oneorthree.phone.internal.notification.service.NotificationSnapshotService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 알림 서버의 사용자 스냅샷과 발송 직전 적격성 조회.
 * 서비스 토큰과 METHOD·경로 허용목록은 InternalAuthFilter가 검증한다.
 */
@RestController
@RequiredArgsConstructor
public class InternalNotificationController {

    private final NotificationSnapshotService notificationSnapshotService;
    private final NotificationEligibilityService notificationEligibilityService;

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
