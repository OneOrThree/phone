package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
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
        // 임의 문구는 서비스 공지만 허용한다. 친구·잡지 같은 도메인 사건을 관리자 본문으로 위장하지 않는다.
        if (!"ADMIN_ANNOUNCEMENT".equals(Json.text(body, "kind"))) {
            throw new NotificationFailure(400, "INVALID_PUBLICATION_KIND");
        }
        // 요청 키와 발행 id 모두 고정한다. 응답 유실 뒤 새 키로 재시도해도 수신자가 중복되지 않는다.
        return store.command("publication-request:" + publicationId, key, body,
                () -> store.command("publication", publicationId.toString(), body,
                        () -> enqueue(actor, publicationId, body)));
    }

    /** 대기·재시도 분을 종결한다. 이미 FCM 호출 중인 건은 별도 수치로 알려 단정하지 않는다. */
    @Transactional
    public Map<String, Object> cancel(String actor, UUID publicationId) {
        store.lock("publication-cancel:" + publicationId);
        String subject = publicationId.toString();
        // 발송 준비가 같은 행에 임대를 쓰므로, 잠금 뒤에 집계해야 취소 직전의 임대를 놓치지 않는다.
        List<Map<String, Object>> rows = store.rows("SELECT status,last_error,lease_expires_at FROM deliveries"
                + " WHERE kind='ADMIN_ANNOUNCEMENT' AND subject_id=? ORDER BY id FOR UPDATE", subject);
        if (rows.isEmpty() && store.one("SELECT 1 FROM commands WHERE scope='publication' AND command_key=?",
                subject) == null) {
            throw new NotificationFailure(404, "PUBLICATION_NOT_FOUND");
        }
        Instant at = clock.instant();
        long sent = 0;
        long inFlight = 0;
        long alreadyCancelled = 0;
        for (Map<String, Object> row : rows) {
            String status = row.get("status").toString();
            boolean cancelled = "SUPPRESSED".equals(status) && "ADMIN_CANCELLED".equals(row.get("last_error"));
            if ("SENT".equals(status)) {
                sent++;
            }
            if (cancelled) {
                alreadyCancelled++;
            }
            if (("PENDING".equals(status) || "DEFERRED".equals(status) || cancelled)
                    && row.get("lease_expires_at") instanceof Timestamp lease
                    && lease.toInstant().isAfter(at)) {
                inFlight++;
            }
        }
        store.update("INSERT INTO publication_cancellations(publication_id,actor,cancelled_at) VALUES(?,?,?)"
                + " ON CONFLICT(publication_id) DO NOTHING", publicationId, actor, Timestamp.from(at));
        int cancelled = store.update("UPDATE deliveries SET status='SUPPRESSED',last_error='ADMIN_CANCELLED',"
                + "lease_token=CASE WHEN lease_expires_at>? THEN lease_token ELSE NULL END,"
                + "lease_expires_at=CASE WHEN lease_expires_at>? THEN lease_expires_at ELSE NULL END"
                + " WHERE kind='ADMIN_ANNOUNCEMENT' AND subject_id=?"
                + " AND status IN ('PENDING','DEFERRED')", Timestamp.from(at), Timestamp.from(at), subject);
        long totalCancelled = alreadyCancelled + cancelled;
        audit.record(actor, "publications.cancelled", subject,
                Map.of("cancelledCount", cancelled, "totalCancelledCount", totalCancelled,
                        "sentCount", sent, "inFlightCount", inFlight));
        return Map.of("publicationId", subject, "cancelledCount", cancelled,
                "totalCancelledCount", totalCancelled, "sentCount", sent, "inFlightCount", inFlight,
                "recipientCount", rows.size());
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
