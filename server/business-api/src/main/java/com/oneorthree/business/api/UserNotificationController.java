package com.oneorthree.business.api;

import com.oneorthree.business.api.dto.DeviceTokenRegisterRequest;
import com.oneorthree.business.api.dto.DeviceTokenRegisterResponse;
import com.oneorthree.business.api.dto.NotificationSettingsRequest;
import com.oneorthree.business.api.dto.NotificationSettingsResponse;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.auth.LoginUser;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.notification.dto.DeviceRegistrationResult;
import com.oneorthree.business.upstream.notification.dto.NotificationSettingsView;
import com.oneorthree.business.usecase.DeviceTokenUseCase;
import com.oneorthree.business.usecase.NotificationSettingsUseCase;
import com.oneorthree.business.usecase.RequestIdempotencyKeys;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 기기 토큰·알림 설정 — <b>기존 URI·성공 상태를 보존</b>한다.
 *
 * <ul>
 *   <li>{@code PUT /api/v1/users/me/device-token} → 204 (본문은 additive 하게 추가)</li>
 *   <li>{@code DELETE /api/v1/users/me/device-token} → 204</li>
 *   <li>{@code PUT /api/v1/users/me/notification-settings} → 204</li>
 *   <li>{@code GET /api/v1/users/me/notification-settings} → 200 5필드</li>
 * </ul>
 *
 * <p>DELETE 의 대상 토큰·CAS 값은 <b>헤더로</b> 받는다 — 현 요청에는 본문이 아예 없어서
 * ({@code userApi.ts:91-94} 의 bare axios) 본문으로 요구하면 구 앱의 로그아웃이 전부 거부된다
 * (A22 ㊪ · ㊟). 헤더가 없으면 거절하지 않고 그대로 진행하며, 그 기간의 경합을 인정한다.
 *
 * <p><b>「없음」과 「깨짐」은 다르다.</b> {@code X-Device-Ownership} 이 실렸는데 정규 UUID 표기가
 * 아니면 400 으로 거절한다 — 그 값은 알림 서버가 발급한 CAS 이므로 어느 행에도 맞지 않고, 「없음」
 * 으로 접으면 CAS 검사가 사라져 그 사이 재등록된 지금 기기까지 지운다(㊚). 판정은
 * {@link com.oneorthree.business.common.validation.DeviceOwnershipTokens} 한 곳에만 둔다 — 같은 규칙을
 * 컨트롤러에도 복제하면 그중 하나만 고쳐지는 날이 온다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class UserNotificationController {

    /** 삭제 대상 FCM 토큰 — 본문이 없으니 헤더다(A22 ㊪). */
    public static final String HEADER_DEVICE_TOKEN = "X-Device-Token";
    /** 삭제 요청의 CAS 값(A22 ㊟). */
    public static final String HEADER_DEVICE_OWNERSHIP = "X-Device-Ownership";

    private final DeviceTokenUseCase deviceTokenUseCase;
    private final NotificationSettingsUseCase notificationSettingsUseCase;

    @PutMapping("/users/me/device-token")
    public ResponseEntity<DeviceTokenRegisterResponse> registerDeviceToken(
            @Valid @RequestBody DeviceTokenRegisterRequest body,
            @LoginUser AccessTokenClaims claims,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {

        DeviceRegistrationResult result = deviceTokenUseCase.register(claims, body.deviceToken(),
                body.ownershipToken(), body.deviceBootstrap(),
                RequestIdempotencyKeys.from(idempotencyKey), Deadline.unbounded());

        // 기존 계약은 204 본문 없음이다. 구 앱은 본문을 읽지 않으므로 값을 실어도 깨지지 않는다.
        return ResponseEntity.ok(new DeviceTokenRegisterResponse(
                result == null ? null : result.ownershipToken()));
    }

    @DeleteMapping("/users/me/device-token")
    public ResponseEntity<Void> clearDeviceToken(
            @LoginUser AccessTokenClaims claims,
            @RequestHeader(name = HEADER_DEVICE_TOKEN, required = false) String deviceToken,
            @RequestHeader(name = HEADER_DEVICE_OWNERSHIP, required = false) String ownershipToken,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {

        deviceTokenUseCase.delete(claims, deviceToken, ownershipToken,
                RequestIdempotencyKeys.from(idempotencyKey), Deadline.unbounded());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/users/me/notification-settings")
    public ResponseEntity<Void> updateNotificationSettings(
            @Valid @RequestBody NotificationSettingsRequest body,
            @LoginUser AccessTokenClaims claims,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {

        notificationSettingsUseCase.update(claims.userId(), body,
                RequestIdempotencyKeys.from(idempotencyKey), Deadline.unbounded());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/users/me/notification-settings")
    public ResponseEntity<NotificationSettingsResponse> getNotificationSettings(
            @LoginUser AccessTokenClaims claims) {

        NotificationSettingsView view = notificationSettingsUseCase.read(claims.userId(), Deadline.unbounded());
        return ResponseEntity.ok(new NotificationSettingsResponse(
                view.notificationEnabled(),
                view.soundEnabled(),
                view.nightModeEnabled(),
                view.nightStartTime(),
                view.nightEndTime()));
    }
}
