package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.DurableCommandAck;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.resultPath;
import static com.oneorthree.business.upstream.data.DataPaths.userPath;

/**
 * Data outbox·내구 명령 축의 호출 — 기기 토큰 삭제·알림 설정의 내구 적재와 전달 완료 표시,
 * 결과 표시 claim/ack 의 2단계 신호.
 */
public class DataOutboxClient {

    private static final String PATH_DEVICE_TOKEN_DELETIONS = "/internal/users/{userId}/device-token-deletions";
    private static final String PATH_NOTIFICATION_SETTINGS_COMMANDS =
            "/internal/users/{userId}/notification-settings-commands";
    private static final String PATH_COMMAND_DELIVERED = "/internal/outbox-commands/{commandId}/delivered";
    private static final String PATH_RESULT_CLAIM = "/internal/users/{userId}/challenge-results/{sessionId}/claim";
    private static final String PATH_RESULT_ACK = "/internal/users/{userId}/challenge-results/{sessionId}/ack";

    private final InternalHttpClient http;

    public DataOutboxClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 기기 토큰 삭제 outbox 를 <b>직접 삭제 「전에」</b> 기록한다 (A22 ㊲ · ㊿ · ㊨ · ㊪).
     *
     * <p>순서를 뒤집으면(실패 후에야 기록) 그 사이 프로세스가 죽을 때 직접 삭제도 outbox 도 남지 않고,
     * 앱은 이 DELETE 실패를 삼키고 로컬 인증을 지우므로 <b>아무도 재시도하지 않고 이전 계정 푸시가
     * 그 기기로 계속 간다</b>.
     *
     * @param deviceToken     대상 FCM 토큰 — {@code X-Device-Token} 으로 받은 값(㊪). 없으면 outbox 를
     *                        계약대로 만들 수 없다
     * @param ownershipToken  {@code X-Device-Ownership} 으로 받은 CAS 값(㊚). 롤아웃 기간엔 null 가능
     * @param authGeneration  AT 의 {@code gen} claim. <b>없으면 null 그대로</b> 보낸다(㊍)
     */
    public DurableCommandAck recordDeviceTokenDeletion(UUID userId, String deviceToken, String ownershipToken,
            Long authGeneration, String idempotencyKey, Deadline deadline) {
        return recordDeviceTokenDeletion(userId, deviceToken, ownershipToken, authGeneration,
                null, idempotencyKey, deadline);
    }

    public DurableCommandAck recordDeviceTokenDeletion(UUID userId, String deviceToken, String ownershipToken,
            Long authGeneration, UUID sessionId, String idempotencyKey, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, userPath(PATH_DEVICE_TOKEN_DELETIONS, userId))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(new DeviceTokenDeletionCommand(deviceToken, ownershipToken, authGeneration, sessionId))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DurableCommandAck>() { });
    }

    /**
     * 알림 설정 변경을 <b>Data 에 먼저 내구 저장</b>한다 (A22 ㊷ · ㋕ · §3).
     *
     * <p>동기 호출만으로 끝내면 알림 서버 장애가 공통 재시도보다 길 때 변경이 영구 유실되는데,
     * 앱은 {@code NotificationSettingsScreen.tsx:142-148} 에서 <b>화면을 먼저 바꾼 뒤 서버 오류를 삼키고
     * 「다음 변경 때」까지 재시도하지 않는다</b> — 사용자는 껐다고 보는데 정본은 계속 true 라 푸시가
     * 무기한 간다. 그래서 Data outbox(relay 가 재전달)를 먼저 만든다.
     *
     * <p>응답의 {@code version} 이 <b>역순 적용을 막는 유일한 값</b>이다(㋕) — 「끔」이 알림엔 성공했지만
     * 완료 표시만 실패하고 뒤이은 「켬」이 끝까지 성공하면, relay 가 남은 「끔」을 나중에 적용해 사용자가
     * 켠 설정을 도로 끈다.
     */
    public DurableCommandAck recordNotificationSettings(UUID userId, Object settings, String idempotencyKey,
            Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PUT, userPath(PATH_NOTIFICATION_SETTINGS_COMMANDS, userId))
                        .onBehalfOf(userId)
                        .idempotencyKey(idempotencyKey)
                        .body(settings)
                        // 전체 교체 PUT 이라 멱등이다(§4 의 재시도 대상).
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DurableCommandAck>() { });
    }

    /** 신규 설정의 동기 사용자/세션 검사와 초기화용 mirror 스냅샷은 같은 Data TX다. */
    public JsonNode settingsSnapshot(UUID userId, UUID sessionId, long generation, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST,
                                "/internal/users/" + userId + "/notification-settings-snapshot")
                        .onBehalfOf(userId)
                        .body(Map.of("sessionId", sessionId, "authGeneration", generation))
                        .idempotentCommand()
                        .build(), deadline, new ParameterizedTypeReference<JsonNode>() { });
    }

    /** UUID 앱 키를 그대로 Data의 공개 명령 receipt에 전달한다. */
    public JsonNode patchSettings(UUID userId, UUID sessionId, long generation, boolean notifications,
            UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.PATCH, userPath(PATH_NOTIFICATION_SETTINGS_COMMANDS, userId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(Map.of("notifications", notifications, "sessionId", sessionId,
                                "authGeneration", generation))
                        .idempotentCommand()
                        .build(), deadline, new ParameterizedTypeReference<JsonNode>() { });
    }

    /**
     * 직접 전달이 성공했으니 그 outbox 행을 완료 표시한다 (㊿ 의 「빠른 경로」).
     *
     * <p><b>이 호출이 실패해도 사용자 요청을 실패시키지 않는다</b> — relay 가 한 번 더 보낼 뿐이고,
     * 위성의 멱등·version 규칙이 중복 적용을 흡수한다. 반대로 여기서 실패를 올리면 이미 반영된 변경이
     * 사용자에게 오류로 보인다.
     */
    public void markCommandDelivered(UUID userId, UUID commandId, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST, PATH_COMMAND_DELIVERED.replace("{commandId}", commandId.toString()))
                        .onBehalfOf(userId)
                        .idempotentCommand()
                        .build(),
                deadline);
    }

    /**
     * 결과 표시 선점 — 알림 서버가 끼지 않는다. 조건부 원자 UPDATE 라 <b>재시도하지 않는다</b>:
     * 최초 획득은 멱등이 아니고(두 번째 시도가 남의 리스를 가져올 수 있다) 실패 응답이 계약이다
     * ({@code RESULT_CLAIM_HELD} + {@code retryAfterMs}).
     */
    public Object claimResultDisplay(UUID userId, UUID sessionId, UUID currentToken, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, resultPath(PATH_RESULT_CLAIM, userId, sessionId))
                        .onBehalfOf(userId)
                        .body(Map.of("claimToken", currentToken == null ? "" : currentToken.toString()))
                        .build(),
                deadline,
                new ParameterizedTypeReference<Object>() { });
    }

    /**
     * 결과 확인(ack) 커밋 — 2단계의 <b>가운데</b>다 (A22 ⓓ). 앞에 알림 prepare, 뒤에 알림 commit 이 온다.
     *
     * <p>재시도하지 않는다: {@code acknowledged_at IS NULL} 조건부 UPDATE 라 두 번째 시도는 0행이 되고,
     * 그 0행을 실패로 읽으면 이미 성공한 ack 가 실패로 보고된다.
     */
    public void acknowledgeResult(UUID userId, UUID sessionId, UUID claimToken, Instant ackDeadlineAt,
            Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST, resultPath(PATH_RESULT_ACK, userId, sessionId))
                        .onBehalfOf(userId)
                        .body(Map.of("claimToken", claimToken == null ? "" : claimToken.toString(),
                                "ackDeadlineAt", ackDeadlineAt.toString()))
                        .build(),
                deadline);
    }

    /** 삭제 outbox 요청 본문. {@code authGeneration} 은 <b>없으면 null</b> 이고 채우지 않는다(㊍). */
    record DeviceTokenDeletionCommand(String deviceToken, String ownershipToken, Long authGeneration,
            UUID sessionId) {
    }
}
