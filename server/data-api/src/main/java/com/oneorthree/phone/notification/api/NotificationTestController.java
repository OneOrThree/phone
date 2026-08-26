package com.oneorthree.phone.notification.api;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.common.port.PushNotificationPort;
import com.oneorthree.phone.common.port.PushSendResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 테스트 푸시 발송 (GROMO-528) — E2E 파이프라인 검증용, prod 미노출.
 * JwtFilter 화이트리스트에 등록돼 인증 없이 호출 가능 — body 의 deviceToken 으로 직접 발송한다.
 * 필터 체인(알림 설정·Quiet hours)도 의도적으로 우회 — 심야 테스트가 스킵돼 헷갈리는 일 방지.
 */
@Tag(name = "notification-test", description = "테스트 푸시 발송 (local/dev/staging 전용 — 인증·필터 미적용)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
/**
 * prod 만 제외 — ci 포함은 OpenAPI 문서 생성(generateOpenApiDocs)이 ci 프로파일로 부팅하기 때문.
 * ci 를 빼면 이 엔드포인트가 스펙에서 누락돼 Apidog 에 안 올라온다 (런타임 노출 아님, prod 미노출 유지).
 */
@Profile({"local", "ci", "dev", "staging"})
public class NotificationTestController {

    private final PushNotificationPort pushNotificationPort;

    @Operation(summary = "테스트 푸시 발송",
            description = "body 의 deviceToken(FCM registration token)으로 즉시 발송. 인증·알림 설정·심야 필터 미적용. "
                    + "title/body/link 는 선택 — 생략 시 기본 문구. local/ci 프로파일에서는 NoOp 이라 실제 발송되지 않음.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "발송 시도 완료 — result 로 판별 (SENT/INVALID_TOKEN/FAILED)"),
        @ApiResponse(responseCode = "400", description = "deviceToken 누락")
    })
    @PostMapping("/notifications/test")
    public ResponseEntity<TestPushResponse> sendTestPush(@Valid @RequestBody TestPushRequest body) {
        PushMessage message = new PushMessage(
                orDefault(body.title(), "테스트 푸시"),
                orDefault(body.body(), "gromo 푸시 파이프라인 E2E 확인용이야!"),
                orDefault(body.link(), "gromo://home"),
                true);
        PushSendResult result = pushNotificationPort.send(body.deviceToken(), message);
        return ResponseEntity.ok(new TestPushResponse(result.name()));
    }

    private static String orDefault(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value;
    }

    /** 테스트 전용 요청 — deviceToken 필수, 나머지 선택 (QA 편의상 컨트롤러 내 중첩 record, 정식 DTO 아님). */
    public record TestPushRequest(@NotBlank String deviceToken, String title, String body, String link) {
    }

    /** 발송 결과 — SENT / INVALID_TOKEN / FAILED. */
    public record TestPushResponse(String result) {
    }
}
