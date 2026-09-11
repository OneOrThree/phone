package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.DurableCommandAckResponse;
import com.oneorthree.phone.internal.dto.UserActivationResponse;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.user.dto.DeviceTokenDeletionRequest;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 유저 축 내부 표면 — 활성 검사 · 기기 토큰 삭제 · 알림 설정 · 완료 표시 (A22 ⓖ · ㊲ · ㊷ · ㊿).
 *
 * <h2>{@code X-User-Id} 를 여기서 다시 검증하지 않는다</h2>
 * {@code InternalAuthFilter} 가 <b>이미</b> 「서비스 토큰 → caller → 허용목록 → 경로의 유저와 일치」를
 * 끝냈다. 여기서 한 번 더 비교하면 같은 규칙이 두 곳에 생기고, 그중 하나만 고쳐지는 날이 온다.
 *
 * <p>Swagger 문서를 붙이지 않는 것도 의도다 — 이 표면은 앱 계약이 아니라 <b>서비스 간</b> 계약이고
 * 정본은 {@code docs/contracts/business-satellite-api.yaml} 이다. 공개 문서에 실리면 그 자체가
 * 「호출해도 되는 곳」이라는 신호가 된다.
 */
@RestController
@RequestMapping("/internal")
@RequiredArgsConstructor
public class InternalUserController {

    private final UserSatelliteCommandService userSatelliteCommandService;

    /**
     * 위성 쓰기 전 활성 검사 (ⓖ).
     *
     * <p>⚠️ <b>{@code authGeneration} 을 응답에 담지 않는다</b>(㊍) — 담으면 「AT 에 {@code gen} 이
     * 없으니 여기서 받은 현재 세대로 채우자」는 우회가 생기고, 그건 로그아웃 전에 발급된 옛 AT 를
     * 최신 세대로 태깅해 기기 토큰 tombstone 을 통째로 지나간다.
     *
     * @param userId 경로의 대상 유저 — 필터가 {@code X-User-Id} 와 같음을 이미 보장했다
     * @return 활성 여부
     */
    @GetMapping("/users/{userId}/activation")
    public ResponseEntity<UserActivationResponse> checkActivation(@PathVariable UUID userId) {
        return ResponseEntity.ok(new UserActivationResponse(userSatelliteCommandService.isActive(userId)));
    }

    /**
     * 기기 토큰 삭제 outbox 기록 — 호출자는 <b>직접 삭제 「전에」</b> 부른다 (㊲ · ㊿).
     *
     * @param userId         대상 유저
     * @param request        대상 토큰·소유권 값·AT 세대. 셋 다 없을 수 있다(구 앱)
     * @param idempotencyKey {@code Idempotency-Key}. 없으면 서버가 이번 호출용 키를 만든다(㉼)
     * @return 완성된 봉투
     */
    @PostMapping("/users/{userId}/device-token-deletions")
    public ResponseEntity<DurableCommandAckResponse> recordDeviceTokenDeletion(
            @PathVariable UUID userId,
            @Valid @RequestBody DeviceTokenDeletionRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {

        return ResponseEntity.ok(ack(
                userSatelliteCommandService.recordDeviceTokenDeletion(userId, request, idempotencyKey)));
    }

    /**
     * 알림 설정 <b>전체 교체</b>를 내구 기록 (㊷ · ㋕).
     *
     * @param userId         대상 유저
     * @param request        앱이 보낸 5필드 전부
     * @param idempotencyKey {@code Idempotency-Key}
     * @return 완성된 봉투 — 위성이 이 {@code version} 으로 역순 적용을 막는다
     */
    @PutMapping("/users/{userId}/notification-settings-commands")
    public ResponseEntity<DurableCommandAckResponse> recordNotificationSettings(
            @PathVariable UUID userId,
            @Valid @RequestBody NotificationSettingsRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {

        return ResponseEntity.ok(ack(
                userSatelliteCommandService.recordNotificationSettings(userId, request, idempotencyKey)));
    }

    /**
     * 완성된 봉투 → 응답. {@code commandId} 는 {@code eventId} 를 UUID 로 읽은 값이다 — 요청형 명령의
     * {@code eventId} 는 순수 UUID 문자열이라 되파싱이 필요 없다(그래서 접두사를 붙이지 않는다).
     */
    private static DurableCommandAckResponse ack(EventEnvelope envelope) {
        return new DurableCommandAckResponse(
                UUID.fromString(envelope.eventId()), envelope.eventId(), envelope.version());
    }
}
