package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** 검토한 최종 렌더 결과를 고정한다. 발송 시점의 템플릿 변경은 이 문구에 영향을 주지 않는다. */
@Service
class PublicationService {
    private final Store store;
    private final AdminAudit audit;
    private final Clock clock;

    PublicationService(Store store, AdminAudit audit, Clock clock) {
        this.store = store;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    public Map<String, Object> publish(String actor, UUID publicationId, Map<String, Object> body, String key) {
        // 요청 키와 발행 id 모두 고정한다. 응답 유실 뒤 새 키로 재시도해도 수신자가 중복되지 않는다.
        return store.command("publication-request:" + publicationId, key, body,
                () -> store.command("publication", publicationId.toString(), body,
                        () -> enqueue(actor, publicationId, body)));
    }

    private Map<String, Object> enqueue(String actor, UUID publicationId, Map<String, Object> body) {
        String kind = Json.text(body, "kind");
        String locale = Json.text(body, "locale");
        if (!Set.of("ko", "en", "ja", "zh-Hant").contains(locale)) {
            throw new NotificationFailure(400, "INVALID_LOCALE");
        }
        Map<String, Object> catalog = store.one("SELECT enabled,silent FROM kinds WHERE id=?", kind);
        if (catalog == null || !Boolean.TRUE.equals(catalog.get("enabled"))) {
            throw new NotificationFailure(409, "NOTIFICATION_KIND_DISABLED");
        }
        RenderedPush push = reviewedPush(body);
        if (push.silent() != Boolean.TRUE.equals(catalog.get("silent"))) {
            throw new NotificationFailure(400, "PUBLICATION_SILENT_MISMATCH");
        }
        FcmPayload.requireFits(push.withDeliveryTag(new UUID(0, 0).toString()), true,
                "publication:" + publicationId + ":" + new UUID(0, 0));
        List<UUID> recipients = recipients(body);
        Map<String, Object> params = AdminCatalog.object(body, "params");
        String subject = Json.nullableText(body, "subjectId");
        if ("ADMIN_ANNOUNCEMENT".equals(kind)) {
            subject = publicationId.toString();
        }
        Map<String, Object> frozen = new LinkedHashMap<>();
        frozen.put("title", push.title());
        frozen.put("body", push.body());
        frozen.put("data", push.data());
        frozen.put("silent", push.silent());
        List<String> ids = new ArrayList<>();
        store.lock("device-ownership");
        for (UUID user : recipients) {
            Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", user);
            if (fence != null && Boolean.TRUE.equals(fence.get("withdrawn"))) {
                throw new NotificationFailure(409, "USER_WITHDRAWN");
            }
            UUID id = UUID.randomUUID();
            store.update("INSERT INTO deliveries(id,event_id,user_id,kind,subject_id,payload,locale,"
                    + "admin_actor,reviewed_push,next_attempt_at,created_at)"
                    + " VALUES(?,?,?,?,?,?::jsonb,?,?,?::jsonb,?,?)",
                    id, "publication:" + publicationId + ":" + user, user, kind, subject, Json.write(params),
                    locale, actor, Json.write(frozen),
                    Timestamp.from(clock.instant()), Timestamp.from(clock.instant()));
            ids.add(id.toString());
        }
        audit.record(actor, "publications.enqueued", publicationId.toString(),
                Map.of("recipientCount", ids.size(), "kind", kind, "contentHash", Json.hash(frozen)));
        Map<String, Object> gate = store.one("SELECT enabled FROM dispatch_control WHERE id=1");
        return Map.of("publicationId", publicationId.toString(), "status", "PENDING", "deliveryIds", ids,
                "recipientCount", ids.size(),
                "dispatchEnabled", gate != null && Boolean.TRUE.equals(gate.get("enabled")));
    }

    static RenderedPush reviewedPush(Map<String, Object> body) {
        Map<String, Object> values = AdminCatalog.object(body, "data");
        Map<String, String> data = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            if (Set.of("deliveryTag", "eventId").contains(entry.getKey())) {
                throw new NotificationFailure(400, "RESERVED_DATA_KEY");
            }
            if (!(entry.getValue() instanceof String value)) {
                throw new NotificationFailure(400, "INVALID_PUBLICATION_DATA");
            }
            data.put(entry.getKey(), value);
        }
        return new RenderedPush(Json.nullableText(body, "title"), Json.text(body, "body"), data,
                Json.bool(body, "silent"));
    }

    private static List<UUID> recipients(Map<String, Object> body) {
        if (!(body.get("userIds") instanceof List<?> values) || values.isEmpty() || values.size() > 100) {
            throw new NotificationFailure(400, "INVALID_PUBLICATION_RECIPIENTS");
        }
        List<UUID> users = new ArrayList<>();
        for (Object value : values) {
            if (!(value instanceof String text)) {
                throw new NotificationFailure(400, "INVALID_PUBLICATION_RECIPIENTS");
            }
            try {
                UUID user = UUID.fromString(text);
                if (!user.toString().equalsIgnoreCase(text) || users.contains(user)) {
                    throw new IllegalArgumentException();
                }
                users.add(user);
            } catch (IllegalArgumentException invalid) {
                throw new NotificationFailure(400, "INVALID_PUBLICATION_RECIPIENTS");
            }
        }
        return users;
    }
}
