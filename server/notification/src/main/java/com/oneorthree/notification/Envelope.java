package com.oneorthree.notification;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** 전송 형식과 상태 순서 버전을 별도로 검사한다. 추가 필드는 무시한다. */
record Envelope(String eventId, String type, UUID userId, long version, String subjectId,
        String locale, Instant occurredAt, Instant scheduledAt, Map<String, Object> params) {

    static Envelope read(Map<String, Object> body) {
        if (Json.number(body, "schemaVersion") != 1) {
            throw new NotificationFailure(422, "UNSUPPORTED_SCHEMA_VERSION");
        }
        String id = Json.text(body, "eventId");
        String type = Json.text(body, "type");
        String subject = Json.nullableText(body, "subjectId");
        long version = Json.number(body, "version");
        if (id.length() > 200 || type.length() > 100 || version == 0
                || (subject != null && subject.length() > 200) || !(body.get("params") instanceof Map<?, ?>)) {
            throw new NotificationFailure(422, "INVALID_EVENT_ENVELOPE");
        }
        try {
            String scheduled = Json.nullableText(body, "scheduledAt");
            return new Envelope(id, type, Json.uuid(body, "userId"), version, subject,
                    Json.nullableText(body, "locale"), Instant.parse(Json.text(body, "occurredAt")),
                    scheduled == null ? null : Instant.parse(scheduled), Json.map(body.get("params")));
        } catch (java.time.DateTimeException invalid) {
            throw new NotificationFailure(422, "INVALID_EVENT_TIMESTAMP");
        }
    }
}
