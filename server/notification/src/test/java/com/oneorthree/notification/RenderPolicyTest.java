package com.oneorthree.notification;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RenderPolicyTest {
    @Test
    void defaultNullCustomOvernightAndEmptyQuietWindowsMatchLegacy() {
        var settings = NotificationStoreTest.preferences(true);
        assertThat(QuietHours.endIfQuiet(settings, Instant.parse("2026-09-11T14:00:00Z")))
                .isEqualTo(Instant.parse("2026-09-11T22:00:00Z"));
        assertThat(QuietHours.endIfQuiet(settings, Instant.parse("2026-09-11T22:00:00Z"))).isNull();
        settings.put("nightModeEnabled", true);
        settings.put("nightStartTime", "21:30");
        settings.put("nightEndTime", "08:15");
        assertThat(QuietHours.endIfQuiet(settings, Instant.parse("2026-09-11T13:00:00Z")))
                .isEqualTo(Instant.parse("2026-09-11T23:15:00Z"));
        settings.put("nightStartTime", "08:15");
        assertThat(QuietHours.endIfQuiet(settings, Instant.parse("2026-09-11T13:00:00Z"))).isNull();
        settings.put("nightStartTime", null);
        assertThat(QuietHours.endIfQuiet(settings, Instant.parse("2026-09-11T13:00:00Z"))).isNull();
    }

    @Test
    void icuPluralAndMissingArgumentsAreValidated() {
        assertThat(Renderer.format("{count, plural, one {# result} other {# results}}", "en", Map.of("count", 2)))
                .isEqualTo("2 results");
        assertThatThrownBy(() -> Renderer.format("Hello {name}", "en", Map.of()))
                .hasMessage("TEMPLATE_ARGUMENT_MISSING");
    }

    @Test
    void payloadErrorsNeverDeleteAValidRegistration() {
        assertThat(FcmTransport.isUnregistered(400, "{\"error\":{\"message\":\"INVALID_ARGUMENT\"}}"))
                .isFalse();
        assertThat(FcmTransport.isUnregistered(404, Json.write(Map.of("error", Map.of("details", List.of(
                Map.of("@type", "type.googleapis.com/google.firebase.fcm.v1.FcmError", "errorCode", "UNREGISTERED")))))))
                .isTrue();
        assertThat(FcmTransport.isUnregistered(404, "UNREGISTERED")).isFalse();
        // FCM 이 «토큰이 아닌» 필드를 짚었으면 토큰을 죽이지 않는다 — 페이로드 버그 하나로 멀쩡한
        // 기기의 등록이 통째로 사라지면 안 된다.
        assertThat(FcmTransport.unusableToken(400, violation("message.android.notification.color"))).isFalse();
        assertThat(FcmTransport.unusableToken(400, violation("message.data.token"))).isFalse();
        // 모양을 알 수 없는 400 도 토큰 탓으로 돌리지 않는다.
        assertThat(FcmTransport.unusableToken(400, "{\"error\":{\"message\":\"INVALID_ARGUMENT\"}}")).isFalse();
        assertThat(FcmTransport.unusableToken(500, "{\"error\":{\"status\":\"INTERNAL\"}}")).isFalse();
    }

    /**
     * 형식이 깨진 등록 토큰은 {@code 404 UNREGISTERED} 가 아니라 {@code 400 INVALID_ARGUMENT} 로 온다.
     *
     * <p>그것을 재시도로 돌리면 {@code transport_invalid} 가 찍히지 않아 그 토큰의 모든 delivery 가
     * 매분 영구 재시도되고 미전달 행만 쌓인다. 구 {@code FcmPushNotificationClient} 는 같은 응답을
     * 무효 토큰으로 정리해 왔다.
     */
    @Test
    void invalidArgumentCausedByTheTokenTakesTheSameCleanupPathAsUnregistered() {
        assertThat(FcmTransport.unusableToken(400, violation("message.token"))).isTrue();
        assertThat(FcmTransport.unusableToken(400, violation("token"))).isTrue();
        // 어느 필드인지 확정하지 않은 INVALID_ARGUMENT는 정상 기기를 폐기할 근거가 아니다.
        assertThat(FcmTransport.unusableToken(400,
                "{\"error\":{\"status\":\"INVALID_ARGUMENT\",\"message\":\"invalid registration token\"}}"))
                .isFalse();
    }

    @Test
    void anOversizedPayloadDoesNotProveThatTheRegistrationIsInvalid() {
        assertThat(FcmTransport.unusableToken(400,
                "{\"error\":{\"status\":\"INVALID_ARGUMENT\",\"message\":\"Message too big\"}}"))
                .isFalse();
        assertThat(FcmTransport.unusableToken(400, Json.write(Map.of("error", Map.of(
                "status", "INVALID_ARGUMENT", "details", List.of(Map.of(
                        "@type", "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                        "errorCode", "INVALID_ARGUMENT"))))))).isFalse();
    }

    /**
     * 403 은 두 갈래다(GROMO-2521). 다른 FCM 프로젝트에서 발급된 토큰({@code SENDER_ID_MISMATCH})은 서버 프로젝트로
     * 영원히 못 보내므로 {@code UNREGISTERED} 와 같은 결과여야 한다 — 재시도로 남으면 매분 영구 재시도된다.
     * 같은 403 이라도 서버 쪽 사정({@code THIRD_PARTY_AUTH_ERROR} · 권한)은 토큰 탓이 아니므로 재시도로 남는다.
     */
    @Test
    void senderIdMismatchTakesTheUnregisteredPathWhileOtherAuthErrorsStayRetryable() {
        assertThat(FcmTransport.classify(403, fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH")))
                .isEqualTo(PushTransport.Result.UNREGISTERED);
        // 상태만 같다고 토큰을 죽이지 않는다 — FcmError.errorCode 가 SENDER_ID_MISMATCH 여야 한다.
        assertThat(FcmTransport.classify(403, fcmError(403, "PERMISSION_DENIED", "THIRD_PARTY_AUTH_ERROR")))
                .isEqualTo(PushTransport.Result.RETRY);
        assertThat(FcmTransport.classify(401, fcmError(401, "UNAUTHENTICATED", "THIRD_PARTY_AUTH_ERROR")))
                .isEqualTo(PushTransport.Result.RETRY);
        // FcmError 상세가 없는 403(API 비활성 · IAM 권한 등 서버 자격 문제)도 재시도다.
        assertThat(FcmTransport.classify(403, Json.write(Map.of("error",
                Map.of("code", 403, "status", "PERMISSION_DENIED", "message", "Permission denied")))))
                .isEqualTo(PushTransport.Result.RETRY);
        // errorCode 가 같아도 상태가 403 이 아니면 이 갈래가 아니다(404 UNREGISTERED 와 같은 상태 결합).
        assertThat(FcmTransport.classify(500, fcmError(500, "INTERNAL", "SENDER_ID_MISMATCH")))
                .isEqualTo(PushTransport.Result.RETRY);
    }

    @Test
    void finalPayloadIncludesUtf8TextDataAndEventIdInItsLimit() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> FcmTransport.payload("device",
                new RenderedPush("제목", "가".repeat(1400), Map.of(), false), true, "event"))
                .isInstanceOf(NotificationFailure.class).hasMessage("FCM_PAYLOAD_TOO_LARGE");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> FcmTransport.payload("device",
                new RenderedPush("제목", "본문", Map.of("url", "https://example.com/" + "a".repeat(4096)), false),
                true, "event"))
                .isInstanceOf(NotificationFailure.class).hasMessage("FCM_PAYLOAD_TOO_LARGE");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> FcmTransport.payload("device",
                new RenderedPush("제목", "본문", Map.of(), false), true, "e".repeat(4096)))
                .isInstanceOf(NotificationFailure.class).hasMessage("FCM_PAYLOAD_TOO_LARGE");
    }

    /** FCM 이 어느 필드가 잘못됐는지 짚어 주는 실제 응답 모양. */
    private static String violation(String field) {
        return Json.write(Map.of("error", Map.of("status", "INVALID_ARGUMENT", "details", List.of(
                Map.of("@type", "type.googleapis.com/google.rpc.BadRequest",
                        "fieldViolations", List.of(Map.of("field", field, "description", "invalid")))))));
    }

    /** FCM v1 이 돌려주는 실제 오류 모양 — HTTP 상태, gRPC status, 상세의 {@code FcmError.errorCode}. */
    static String fcmError(int code, String status, String errorCode) {
        return Json.write(Map.of("error", Map.of("code", code, "status", status, "details", List.of(
                Map.of("@type", "type.googleapis.com/google.firebase.fcm.v1.FcmError", "errorCode", errorCode)))));
    }

    @Test
    void silentAndVisiblePayloadKeepDifferentApnsContractsAndStableCollapseKey() {
        var silent = Json.map(FcmTransport.payload("device", new RenderedPush(null, "", Map.of("type", "flush"), true),
                true, "event").get("message"));
        assertThat(silent).doesNotContainKey("notification");
        assertThat(Json.map(Json.map(silent.get("apns")).get("headers")))
                .containsEntry("apns-push-type", "background").containsEntry("apns-priority", "5");
        var normal = Json.map(FcmTransport.payload("device", new RenderedPush("제목", "본문", Map.of(), false),
                false, "event").get("message"));
        assertThat(Json.map(Json.map(normal.get("apns")).get("headers")))
                .containsEntry("apns-collapse-id", Json.digest("event"));
        assertThat(Json.map(Json.map(Json.map(normal.get("apns")).get("payload")).get("aps"))).isEmpty();
    }
    @Test
    void visiblePushWithoutOptionalTitleSerializesBody() {
        var message = Json.map(FcmTransport.payload("device", new RenderedPush(null, "본문", Map.of(), false),
                false, "event").get("message"));
        assertThat(Json.map(message.get("notification"))).containsEntry("body", "본문").doesNotContainKey("title");
        assertThat(Json.write(message)).contains("본문");
    }

}
