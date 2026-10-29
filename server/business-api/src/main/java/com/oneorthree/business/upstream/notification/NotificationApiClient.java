package com.oneorthree.business.upstream.notification;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.notification.dto.DeviceRegistration;
import com.oneorthree.business.upstream.notification.dto.DeviceRegistrationResult;
import com.oneorthree.business.upstream.notification.dto.NotificationSettingsView;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

/**
 * 알림 서버로 나가는 유일한 창구.
 *
 * <h2>발송 게이트는 여기서 우회할 수 없다</h2>
 * 이 클라이언트에는 「발송」 호출이 없다. 신 서버의 모든 FCM 발송은 공통 {@code dispatch_enabled}
 * 게이트 뒤에서만 일어나고(A22 ㋭), 설정·기기 삭제·ack 억제 같은 <b>상태 변경만</b> 게이트와 무관하게
 * 계속 적용된다. Business 가 발송을 직접 트리거할 경로를 두면 그 게이트가 무의미해진다.
 */
public class NotificationApiClient {

    private static final String PATH_DEVICES = "/internal/devices";
    private static final String PATH_SETTINGS = "/internal/users/{userId}/notification-settings";

    /** 삭제 대상 FCM 토큰 — 현 DELETE 엔 본문이 없어 헤더로 싣는다(A22 ㊪). */
    public static final String HEADER_DEVICE_TOKEN = "X-Device-Token";
    /** 삭제 요청의 CAS 값 — 같은 이유로 헤더다(㊟). */
    public static final String HEADER_DEVICE_OWNERSHIP = "X-Device-Ownership";
    /** AT 의 {@code gen}. 없으면 <b>헤더 자체를 붙이지 않는다</b> — 빈 값이나 0 을 보내면 세대 판정이 뒤집힌다. */
    public static final String HEADER_AUTH_GENERATION = "X-Auth-Generation";

    private final InternalHttpClient http;

    public NotificationApiClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 기기 토큰 등록. <b>POST 지만 재시도한다</b> — 같은 {@code Idempotency-Key} 와 CAS 값으로
     * 「소유권 mutation 도 멱등 재생」이 계약이기 때문이다(A22 ㊱): version 이 전진하므로 응답 유실 뒤
     * 재시도가 낡은 값으로 «거부»되면 안 되고, 저장된 결과 토큰을 <b>성공으로 재생</b>해야 한다.
     */
    public DeviceRegistrationResult registerDevice(UUID userId, DeviceRegistration registration,
            String idempotencyKey, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_DEVICES)
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(registration)
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DeviceRegistrationResult>() { });
    }

    /**
     * 기기 토큰 삭제. §4 가 <b>명시적으로 재시도 대상으로 지정</b>한 명령이다 — GET 만 재시도하면
     * 로그아웃의 삭제가 일시 오류 한 번에 영구 실패하고, 앱은 그 실패를 삼키고 로컬 토큰을 지워
     * 사용자가 재시도할 방법이 없다.
     *
     * <p>본문이 없어 세 값을 헤더로 싣는다. {@code authGeneration} 이 null 이면 헤더를 <b>붙이지
     * 않는다</b> — 수신 측이 「세대 없음」과 「세대 0」을 구분해야 롤아웃 ②기간의 「검사 없이 수락」이
     * 성립한다.
     */
    public void deleteDevice(UUID userId, String deviceToken, String ownershipToken, Long authGeneration,
            String idempotencyKey, Deadline deadline) {
        deleteDevice(userId, deviceToken, ownershipToken, authGeneration, null, null, idempotencyKey, deadline);
    }

    public void deleteDevice(UUID userId, String deviceToken, String ownershipToken, Long authGeneration,
            UUID sessionId, String bootstrapNonceHash, String idempotencyKey, Deadline deadline) {
        InternalCall.Builder call = InternalCall.to(HttpMethod.DELETE, PATH_DEVICES)
                .onBehalfOf(userId)
                .idempotencyKey(idempotencyKey)
                .header(HEADER_DEVICE_TOKEN, deviceToken)
                .header(HEADER_DEVICE_OWNERSHIP, ownershipToken)
                .header("X-Device-Session", sessionId == null ? null : sessionId.toString())
                .header("X-Device-Bootstrap-Hash", bootstrapNonceHash)
                .idempotentCommand();
        if (authGeneration != null) {
            call.header(HEADER_AUTH_GENERATION, Long.toString(authGeneration));
        }
        http.execute(call.build(), deadline);
    }

    /**
     * 설정 <b>정본</b> 조회 — 소유자가 {@code gromo_notification} 이라 여기서 읽는다(§3).
     *
     * <p>Data 패스스루로 읽으면 이관 후 정본이 아닌 값을 준다. 그게 「껐는데 계속 오는」 상태를
     * 화면에서 정상으로 보이게 만든다.
     */
    public NotificationSettingsView getSettings(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, PATH_SETTINGS.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<NotificationSettingsView>() { });
    }

    /**
     * 설정 적용 — <b>Data 내구 명령을 먼저 저장한 뒤</b> 호출한다(§3 · A22 ㊷).
     *
     * <p>{@code version} 을 함께 보낸다. 알림 서버가 <b>낮은 값을 거부</b>해야 역순 적용이 막힌다(㋕) —
     * 「끔」의 완료 표시만 실패하고 뒤이은 「켬」이 성공한 뒤 relay 가 남은 「끔」을 적용하면 사용자가
     * 켠 설정이 도로 꺼진다.
     *
     * <p>전체 교체 PUT 이라 §4 의 재시도 대상이다.
     */
    public void applySettings(UUID userId, Object settings, long version, String idempotencyKey,
            Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.PUT, PATH_SETTINGS.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .query("version", Long.toString(version))
                        .body(settings)
                        .idempotentCommand()
                        .build(),
                deadline);
    }

    /** 기본값을 만들어 반환하지 않고 검증된 Data baseline으로 없는 행만 초기화해 정본을 읽는다. */
    public JsonNode initializedSettings(UUID userId, Object snapshot, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST,
                                PATH_SETTINGS.replace("{userId}", userId.toString()) + "/initialized")
                        .onBehalfOf(userId)
                        .body(snapshot)
                        .idempotentCommand()
                        .build(), deadline, new ParameterizedTypeReference<JsonNode>() { });
    }

    /**
     * 원 명령의 mask/patch/baseline만 전달하며 성공 applied:true를 본문까지 확인한다.
     * 응답 {@code settings}는 최초·재전달 모두 같은 잠금 경계에서 읽은 Notification의 현재 정본이다(GROMO-2209).
     */
    public JsonNode applySettingsPatch(UUID userId, Object patch, long version, String key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, PATH_SETTINGS.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .query("version", Long.toString(version))
                        .idempotencyKey(key)
                        .body(patch)
                        .idempotentCommand()
                        .build(), deadline, new ParameterizedTypeReference<JsonNode>() { });
    }

}
