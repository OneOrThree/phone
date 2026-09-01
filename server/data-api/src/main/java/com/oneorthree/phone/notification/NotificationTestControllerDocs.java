package com.oneorthree.phone.notification;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

/**
 * {@code NotificationTestController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 *
 * <p>요청·응답 타입이 컨트롤러의 중첩 record 라 여기서 그쪽을 참조한다. 테스트 전용 엔드포인트
 * 하나뿐이라 dto 패키지로 꺼내지 않았다.
 */
@Tag(name = "notification-test", description = "테스트 푸시 발송 (local/dev/staging 전용 — 인증·필터 미적용)")
public interface NotificationTestControllerDocs {

    /**
     * @param body 발송 대상 토큰과 문구
     * @return 발송 시도 결과
     */
    @Operation(summary = "테스트 푸시 발송",
            description = "body 의 deviceToken(FCM registration token)으로 즉시 발송. 인증·알림 설정·심야 필터 미적용. "
                    + "title/body/link 는 선택 — 생략 시 기본 문구. local/ci 프로파일에서는 NoOp 이라 실제 발송되지 않음.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "발송 시도 완료 — result 로 판별 (SENT/INVALID_TOKEN/FAILED)"),
        @ApiResponse(responseCode = "400", description = "deviceToken 누락")
    })
    ResponseEntity<NotificationTestController.TestPushResponse> sendTestPush(
            NotificationTestController.TestPushRequest body);
}
