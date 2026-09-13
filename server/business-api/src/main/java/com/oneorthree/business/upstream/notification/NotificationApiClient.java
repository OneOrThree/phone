package com.oneorthree.business.upstream.notification;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.notification.dto.DeviceRegistration;
import com.oneorthree.business.upstream.notification.dto.DeviceRegistrationResult;
import com.oneorthree.business.upstream.notification.dto.NotificationSettingsView;
import com.oneorthree.business.upstream.notification.dto.ResultAckPrepareResult;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.Map;
import java.util.UUID;

/**
 * 알림 서버로 나가는 유일한 창구.
 *
 * <h2>⚠️ 이 표면은 알림 서버 쪽에 아직 없다</h2>
 * 알림 서버는 이 배치의 N 담당이 구현 중이다. 여기 적힌 경로·스키마는
 * {@code docs/contracts/business-satellite-api.yaml} 로 제안한 계약이며, 실제 구현이 붙기 전에는
 * 런타임에 연결되지 않는다. <b>이 사실을 테스트 mock 성공으로 감추지 않는다.</b>
 *
 * <h2>발송 게이트는 여기서 우회할 수 없다</h2>
 * 이 클라이언트에는 「발송」 호출이 없다. 신 서버의 모든 FCM 발송은 공통 {@code dispatch_enabled}
 * 게이트 뒤에서만 일어나고(A22 ㋭), 설정·기기 삭제·ack 억제 같은 <b>상태 변경만</b> 게이트와 무관하게
 * 계속 적용된다. Business 가 발송을 직접 트리거할 경로를 두면 그 게이트가 무의미해진다.
 */
public class NotificationApiClient {

    private static final String PATH_DEVICES = "/internal/devices";
    private static final String PATH_SETTINGS = "/internal/users/{userId}/notification-settings";
    private static final String PATH_ACK_PREPARE = "/internal/users/{userId}/result-ack/prepare";
    private static final String PATH_ACK_COMMIT = "/internal/users/{userId}/result-ack/commit";
    private static final String PATH_ACK_ABORT = "/internal/users/{userId}/result-ack/abort";

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

    /**
     * ack 2단계의 ①: 대기 클레임을 {@code HELD} 로 선점한다 — <b>행이 없어도 tombstone 을 만든다</b>
     * (A22 ㊅).
     *
     * <p>재시도한다: insert-or-transition 이라 멱등이고, 여기서 실패를 그대로 올리면 Data ack 조차
     * 시도하지 못해 사용자의 확인이 반영되지 않는다.
     */
    public ResultAckPrepareResult prepareResultAck(UUID userId, UUID sessionId, String idempotencyKey,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_ACK_PREPARE.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(Map.of("sessionId", sessionId.toString()))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ResultAckPrepareResult>() { });
    }

    /**
     * ack 2단계의 ③: Data ack 가 커밋된 뒤 억제를 확정한다.
     *
     * <p>이 호출이 실패해도 사용자 요청은 성공이다 — Data 의 {@code acknowledged_at} 은 이미 박혔고,
     * 알림 쪽 {@code HELD} 는 <b>리스 만료 시 {@code NEEDS_CONFIRM}</b> 으로 넘어가 flush 가 계속
     * 건너뛰며, 해제는 알림 서버의 <b>Data 정본 ack 조회</b>로 자기 수렴한다(A22 ⓓ). 그 조회 경로가
     * 없으면 「롤백 직후 프로세스가 죽는 구간」에서 영구 억제가 실재한다.
     */
    public void commitResultAck(UUID userId, UUID sessionId, String idempotencyKey, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST, PATH_ACK_COMMIT.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(Map.of("sessionId", sessionId.toString()))
                        .idempotentCommand()
                        .build(),
                deadline);
    }

    /**
     * ack 2단계의 롤백: Data ack 가 실패했으니 선점을 되돌린다.
     *
     * <p><b>abort 가 실패하는 경로를 「성공한 척」으로 덮지 않는다</b> — 그때 남는 {@code HELD} 는 리스
     * 만료로 {@code NEEDS_CONFIRM} 이 되고, 알림 서버가 Data 정본 ack 를 조회해 수렴한다. 그 수렴이
     * 계약이므로 여기서는 실패를 로그로 남기고 원래의 Data 실패를 사용자에게 올린다.
     */
    public void abortResultAck(UUID userId, UUID sessionId, String idempotencyKey, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST, PATH_ACK_ABORT.replace("{userId}", userId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(Map.of("sessionId", sessionId.toString()))
                        .idempotentCommand()
                        .build(),
                deadline);
    }
}
