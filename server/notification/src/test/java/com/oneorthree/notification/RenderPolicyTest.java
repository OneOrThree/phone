package com.oneorthree.notification;

import org.junit.jupiter.api.Test;

import java.time.Instant;
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
        assertThat(FcmTransport.isUnregistered(404, Json.write(Map.of("error", Map.of("details", java.util.List.of(
                Map.of("@type", "type.googleapis.com/google.firebase.fcm.v1.FcmError", "errorCode", "UNREGISTERED")))))))
                .isTrue();
        assertThat(FcmTransport.isUnregistered(404, "UNREGISTERED")).isFalse();
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
