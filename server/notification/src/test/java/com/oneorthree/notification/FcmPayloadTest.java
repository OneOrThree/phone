package com.oneorthree.notification;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FcmPayloadTest {
    @Test
    void theSerializedUtf8BoundaryIncludesAllPayloadFields() {
        int budget = 4096 - bytes(FcmPayload.create("device", visible(""), true, "event"));
        String body = "가".repeat(budget / 3) + "a".repeat(budget % 3);
        assertThat(bytes(FcmPayload.create("device", visible(body), true, "event"))).isEqualTo(4096);
        assertThatThrownBy(() -> FcmPayload.create("device", visible(body + "a"), true, "event"))
                .isInstanceOf(NotificationFailure.class).hasMessage("FCM_PAYLOAD_TOO_LARGE");
    }

    @Test
    void jsonEscapingAlsoConsumesThePayloadBudget() {
        assertThatThrownBy(() -> FcmPayload.create("device", visible("\n".repeat(2100)), true, "event"))
                .isInstanceOf(NotificationFailure.class).hasMessage("FCM_PAYLOAD_TOO_LARGE");
    }

    @Test
    void silentPayloadCountsOnlyWhatIsActuallySent() {
        Map<String, Object> payload = FcmPayload.create("device",
                new RenderedPush("제".repeat(2000), "본".repeat(2000), Map.of("type", "flush"), true), true, "event");
        assertThat(Json.map(payload.get("message"))).doesNotContainKey("notification");
        assertThatThrownBy(() -> FcmPayload.create("device",
                new RenderedPush(null, "", Map.of("data", "한".repeat(1400)), true), false, "event"))
                .isInstanceOf(NotificationFailure.class).hasMessage("FCM_PAYLOAD_TOO_LARGE");
    }

    private static RenderedPush visible(String body) {
        return new RenderedPush("제목", body, Map.of("url", "gromo://groups/example"), false);
    }

    private static int bytes(Map<String, Object> payload) {
        Map<String, Object> content = new LinkedHashMap<>(Json.map(payload.get("message")));
        content.remove("token");
        return Json.write(Map.of("message", content)).getBytes(StandardCharsets.UTF_8).length;
    }
}
