package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 템플릿 미리보기·시험 발송·수동 재전송.
 * 셋 다 «PushTransport 를 직접 부르지 않는다» — deliveries 에 내구 적재만 하고,
 * 실제 발송은 DispatchService 의 공통 발송 게이트 뒤에서만 일어난다(§7.1.2 · A22 ㋭).
 */
@Service
class AdminService {

    private final Store store;
    private final AdminAudit audit;
    private final AdminCatalog catalog;
    private final Clock clock;

    AdminService(Store store, AdminAudit audit, AdminCatalog catalog, Clock clock) {
        this.store = store;
        this.audit = audit;
        this.catalog = catalog;
        this.clock = clock;
    }

    /** 저장 없이 렌더만 한다. body·title 을 주면 «저장 전 초안»을 그대로 미리 본다. */
    @Transactional
    public Map<String, Object> preview(String actor, String templateId, Map<String, Object> body) {
        Map<String, Object> template = template(templateId);
        audit.record(actor, "templates.preview", templateId, Map.of("override",
                body.containsKey("body") || body.containsKey("title")));
        Map<String, Object> draft = new LinkedHashMap<>(template);
        if (body.containsKey("title")) {
            draft.put("title", Json.nullableText(body, "title"));
        }
        if (body.containsKey("body")) {
            draft.put("body", Json.text(body, "body"));
        }
        RenderedPush push = catalog.renderDraft(draft, AdminCatalog.object(body, "params"));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("templateId", templateId);
        result.put("kind", draft.get("kind"));
        result.put("locale", draft.get("locale"));
        result.put("title", push.title());
        result.put("body", push.body());
        result.put("data", push.data());
        result.put("silent", push.silent());
        return result;
    }

    /** 시험 발송. 게이트가 닫혀 있으면 PENDING 으로 남는다 — 여기서 보내지 않는다. */
    @Transactional
    public Map<String, Object> test(String actor, String templateId, Map<String, Object> body, String key) {
        Map<String, Object> template = template(templateId);
        audit.record(actor, "templates.test", templateId, Map.of("hasSubject", body.get("subjectId") != null));
        return store.command("admin-test:" + templateId, key, Map.of("body", body), () -> {
            if (!Boolean.TRUE.equals(template.get("enabled"))) {
                throw new NotificationFailure(409, "TEMPLATE_DISABLED");
            }
            String kind = template.get("kind").toString();
            Map<String, Object> catalogRow = store.one("SELECT id,enabled FROM kinds WHERE id=?", kind);
            if (catalogRow == null || !Boolean.TRUE.equals(catalogRow.get("enabled"))) {
                throw new NotificationFailure(409, "NOTIFICATION_KIND_DISABLED");
            }
            UUID user = Json.uuid(body, "userId");
            Map<String, Object> params = new LinkedHashMap<>(AdminCatalog.object(body, "params"));
            params.put("kind", kind);
            // 적재 전에 렌더가 되는지 확인한다. 안 그러면 게이트 개방 후에야 TEMPLATE_ARGUMENT_MISSING 이 뜬다.
            catalog.renderDraft(template, params);
            params.put("adminActor", actor);
            params.put("adminTest", true);
            String subject = Json.nullableText(body, "subjectId");
            UUID id = enqueue(actor, user, kind, subject, null, params,
                    template.get("locale").toString(), eventId("admin-test:" + templateId, key), null);
            audit.record(actor, "templates.test.enqueued", id.toString(), Map.of("kind", kind));
            return queued(id, null);
        });
    }

    /**
     * 수동 재전송. 원본 행을 «건드리지 않고» 새 사건 키·새 id 로 한 건을 더 만든다.
     * subject_id 는 그대로 둔다 — null 로 바꾸면 BET_RESULT 의 결과 ack 억제(A22 ⓓ)가 통째로 우회된다.
     * 도메인 사건 키 충돌은 admin_actor 가 붙은 행을 dedup 인덱스에서 빼는 방식으로 피한다.
     */
    @Transactional
    public Map<String, Object> resend(String actor, UUID deliveryId, String key) {
        audit.record(actor, "deliveries.resend", deliveryId.toString(), Map.of());
        return store.command("admin-resend:" + deliveryId, key, Map.of("deliveryId", deliveryId.toString()), () -> {
            Map<String, Object> origin = store.one("SELECT * FROM deliveries WHERE id=?", deliveryId);
            if (origin == null) {
                throw new NotificationFailure(404, "UNKNOWN_DELIVERY");
            }
            UUID user = (UUID) origin.get("user_id");
            Map<String, Object> params = new LinkedHashMap<>(Json.map(origin.get("payload").toString()));
            params.put("adminActor", actor);
            params.put("adminResend", true);
            // 원본 event_id·slot_at 을 그대로 복제하면 UNIQUE(event_id)·묶음 슬롯이 충돌한다.
            UUID id = enqueue(actor, user, origin.get("kind").toString(), (String) origin.get("subject_id"),
                    (UUID) origin.get("group_id"), params, (String) origin.get("locale"),
                    eventId("admin-resend:" + deliveryId, key), deliveryId);
            audit.record(actor, "deliveries.resend.enqueued", id.toString(),
                    Map.of("replayOf", deliveryId.toString(), "kind", origin.get("kind").toString()));
            return queued(id, deliveryId);
        });
    }

    /** 멱등 키 원문을 사건 키에 그대로 넣지 않는다 — 길이 제한·콘솔 내부 값 노출을 함께 피한다. */
    private static String eventId(String scope, String key) {
        return "admin:" + Json.digest(scope + ":" + key);
    }

    private UUID enqueue(String actor, UUID user, String kind, String subject, UUID group,
            Map<String, Object> params, String locale, String eventId, UUID replayOf) {
        store.lock("device-ownership");
        Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", user);
        if (fence != null && Boolean.TRUE.equals(fence.get("withdrawn"))) {
            // 탈퇴 tombstone 을 관리자 조작으로 되살리지 않는다.
            throw new NotificationFailure(409, "USER_WITHDRAWN");
        }
        UUID id = UUID.randomUUID();
        // slot_at 은 비운다. 원본 묶음 슬롯을 복제하면 이월 묶음이 관리자 행과 섞인다.
        int written = store.update("INSERT INTO deliveries(id,event_id,user_id,kind,subject_id,group_id,slot_at,"
                + "payload,locale,status,next_attempt_at,admin_actor,replay_of)"
                + " VALUES(?,?,?,?,?,?,NULL,?::jsonb,?,'PENDING',?,?,?) ON CONFLICT DO NOTHING",
                id, eventId, user, kind, subject, group, Json.write(params), locale,
                Timestamp.from(clock.instant()), actor, replayOf);
        if (written == 0) {
            throw new NotificationFailure(409, "DELIVERY_ALREADY_QUEUED");
        }
        return id;
    }

    private Map<String, Object> queued(UUID id, UUID replayOf) {
        Map<String, Object> gate = store.one("SELECT enabled FROM dispatch_control WHERE id=1");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("deliveryId", id.toString());
        result.put("replayOf", replayOf == null ? null : replayOf.toString());
        result.put("status", "PENDING");
        // 게이트가 닫혀 있으면 적재만 되고 대기한다. 「보냈다」로 응답하지 않는다.
        result.put("dispatchEnabled", gate != null && Boolean.TRUE.equals(gate.get("enabled")));
        return result;
    }

    private Map<String, Object> template(String templateId) {
        if (templateId == null || templateId.isBlank() || templateId.length() > 200) {
            throw new NotificationFailure(400, "INVALID_RESOURCE_ID");
        }
        Map<String, Object> template = store.one("SELECT t.id,t.kind,t.locale,t.title,t.body,t.enabled,k.silent"
                + " FROM templates t JOIN kinds k ON k.id=t.kind WHERE t.id=?", templateId);
        if (template == null) {
            throw new NotificationFailure(404, "UNKNOWN_TEMPLATE");
        }
        return template;
    }
}
