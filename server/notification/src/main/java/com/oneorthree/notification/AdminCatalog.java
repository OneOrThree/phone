package com.oneorthree.notification;

import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/** 콘솔 등록부 CRUD. 목록·단건 수정 모두 실제 DB 를 읽고 쓴다(뷰 전용 스텁이 아니다). */
@Service
class AdminCatalog {

    private static final Set<String> LOCALES = Set.of("ko", "en", "ja", "zh-Hant");
    private final Store store;
    private final AdminAudit audit;
    private final Renderer renderer;

    AdminCatalog(Store store, AdminAudit audit, Renderer renderer) {
        this.store = store;
        this.audit = audit;
        this.renderer = renderer;
    }

    // ── 목록 ────────────────────────────────────────────────────────────

    @Transactional
    public Map<String, Object> jobs(String actor, String cursor, Integer limit) {
        int size = AdminPage.limit(limit);
        audit.record(actor, "jobs.list", null, Map.of("cursor", AdminPage.textCursor(cursor), "limit", size));
        List<Map<String, Object>> rows = store.rows("SELECT j.id,j.owner,j.cron,j.enabled,j.config::text AS config,"
                + "j.updated_at,(SELECT max(r.scheduled_at) FROM job_runs r WHERE r.job_id=j.id"
                + " AND r.completed_at IS NOT NULL) AS last_completed_at,"
                + "(SELECT count(*) FROM job_runs r WHERE r.job_id=j.id AND r.completed_at IS NULL) AS pending_runs"
                + " FROM jobs j WHERE j.id>? ORDER BY j.id LIMIT ?", AdminPage.textCursor(cursor), size);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id"));
            item.put("owner", row.get("owner"));
            item.put("cron", row.get("cron"));
            item.put("enabled", row.get("enabled"));
            item.put("config", Json.map(row.get("config")));
            item.put("updatedAt", instant(row.get("updated_at")));
            item.put("lastCompletedAt", instant(row.get("last_completed_at")));
            item.put("pendingRuns", row.get("pending_runs"));
            // DATA 소유 잡은 알림 서버가 켜고 끌 수 없다. 콘솔이 회색 처리할 수 있게 같이 내려준다.
            item.put("mutable", "NOTIFICATION".equals(row.get("owner")));
            items.add(item);
        }
        return AdminPage.page(items, items.size() < size ? null : (String) rows.get(rows.size() - 1).get("id"));
    }

    @Transactional
    public Map<String, Object> templates(String actor, String cursor, Integer limit) {
        int size = AdminPage.limit(limit);
        audit.record(actor, "templates.list", null, Map.of("cursor", AdminPage.textCursor(cursor), "limit", size));
        List<Map<String, Object>> rows = store.rows("SELECT id,kind,locale,title,body,enabled,version FROM templates"
                + " WHERE id>? ORDER BY id LIMIT ?", AdminPage.textCursor(cursor), size);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id"));
            item.put("kind", row.get("kind"));
            item.put("locale", row.get("locale"));
            item.put("title", row.get("title"));
            item.put("body", row.get("body"));
            item.put("enabled", row.get("enabled"));
            item.put("version", row.get("version"));
            items.add(item);
        }
        return AdminPage.page(items, items.size() < size ? null : (String) rows.get(rows.size() - 1).get("id"));
    }

    @Transactional
    public Map<String, Object> deeplinks(String actor, String cursor, Integer limit) {
        int size = AdminPage.limit(limit);
        audit.record(actor, "deeplinks.list", null, Map.of("cursor", AdminPage.textCursor(cursor), "limit", size));
        List<Map<String, Object>> rows = store.rows("SELECT id,url_template,data_template::text AS data_template"
                + " FROM deeplinks WHERE id>? ORDER BY id LIMIT ?", AdminPage.textCursor(cursor), size);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id"));
            item.put("urlTemplate", row.get("url_template"));
            item.put("dataTemplate", Json.map(row.get("data_template")));
            items.add(item);
        }
        return AdminPage.page(items, items.size() < size ? null : (String) rows.get(rows.size() - 1).get("id"));
    }

    @Transactional
    public Map<String, Object> deliveries(String actor, String cursor, Integer limit, String status, String kind,
            String userId) {
        int size = AdminPage.limit(limit);
        Object[] bound = AdminPage.timeCursor(cursor);
        String state = status(status);
        UUID user = userId == null || userId.isBlank() ? null : uuid(userId);
        audit.record(actor, "deliveries.list", null, Map.of("cursor", cursor == null ? "" : cursor, "limit", size,
                "status", state == null ? "" : state, "kind", kind == null ? "" : kind));
        List<Map<String, Object>> rows = store.rows("SELECT d.id,d.event_id,d.user_id,d.kind,d.subject_id,d.group_id,"
                + "d.slot_at,d.locale,d.status,d.attempts,d.next_attempt_at,d.sent_at,d.last_error,d.created_at,"
                + "d.admin_actor,d.replay_of,d.payload::text AS payload,"
                + "(SELECT count(*) FROM delivery_devices dd WHERE dd.delivery_id=d.id) AS device_count"
                + " FROM deliveries d WHERE (d.created_at,d.id)<(?::timestamptz,?::uuid)"
                + " AND (?::text IS NULL OR d.status=?) AND (?::text IS NULL OR d.kind=?)"
                + " AND (?::uuid IS NULL OR d.user_id=?) ORDER BY d.created_at DESC,d.id DESC LIMIT ?",
                bound[0], bound[1], state, state, blankToNull(kind), blankToNull(kind), user, user, size);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            items.add(delivery(row));
        }
        Map<String, Object> last = rows.isEmpty() ? null : rows.get(rows.size() - 1);
        return AdminPage.page(items, items.size() < size ? null
                : AdminPage.encodeTimeCursor(last.get("created_at"), last.get("id")));
    }

    /** 발송 payload 원문은 «절대» 내보내지 않는다 — 표시명 같은 개인정보가 들어 있다. 키 이름만 준다. */
    private static Map<String, Object> delivery(Map<String, Object> row) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", row.get("id").toString());
        item.put("eventId", row.get("event_id"));
        item.put("userId", row.get("user_id").toString());
        item.put("kind", row.get("kind"));
        item.put("subjectId", row.get("subject_id"));
        item.put("groupId", row.get("group_id") == null ? null : row.get("group_id").toString());
        item.put("slotAt", instant(row.get("slot_at")));
        item.put("locale", row.get("locale"));
        item.put("status", row.get("status"));
        item.put("attempts", row.get("attempts"));
        item.put("nextAttemptAt", instant(row.get("next_attempt_at")));
        item.put("sentAt", instant(row.get("sent_at")));
        item.put("lastError", row.get("last_error"));
        item.put("createdAt", instant(row.get("created_at")));
        item.put("adminActor", row.get("admin_actor"));
        item.put("replayOf", row.get("replay_of") == null ? null : row.get("replay_of").toString());
        item.put("deviceCount", row.get("device_count"));
        item.put("paramKeys", new ArrayList<>(new TreeSet<>(Json.map(row.get("payload")).keySet())));
        return item;
    }

    // ── 단건 수정 ───────────────────────────────────────────────────────

    /** 자원 이름은 여기서만 해석한다. 문자열을 SQL 식별자로 이어 붙이는 경로는 만들지 않는다. */
    @Transactional
    public Map<String, Object> put(String actor, String resource, String id, Map<String, Object> body, String key) {
        if (id == null || id.isBlank() || id.length() > 200) {
            throw new NotificationFailure(400, "INVALID_RESOURCE_ID");
        }
        switch (resource) {
            case "jobs", "templates", "deeplinks" -> { }
            default -> throw new NotificationFailure(404, "UNKNOWN_ADMIN_RESOURCE");
        }
        audit.record(actor, resource + ".put", id, Map.of("fields", new ArrayList<>(new TreeSet<>(body.keySet()))));
        return store.command("admin-put:" + resource + ":" + id, key, Map.of("body", body), () -> switch (resource) {
            case "jobs" -> putJob(actor, id, body);
            case "templates" -> putTemplate(actor, id, body);
            case "deeplinks" -> putDeeplink(actor, id, body);
            default -> throw new NotificationFailure(404, "UNKNOWN_ADMIN_RESOURCE");
        });
    }

    private Map<String, Object> putJob(String actor, String id, Map<String, Object> body) {
        Map<String, Object> job = store.one("SELECT id,owner FROM jobs WHERE id=? FOR UPDATE", id);
        if (job == null) {
            throw new NotificationFailure(404, "UNKNOWN_JOB");
        }
        // DATA 소유 잡은 코어 이력을 읽어 판정한다(A22 ⓘ·ⓤ). 알림 서버가 제어할 수 없으므로 거절한다.
        if (!"NOTIFICATION".equals(job.get("owner"))) {
            throw new NotificationFailure(409, "JOB_OWNED_BY_DATA");
        }
        boolean enabled = Json.bool(body, "enabled");
        String cron = Json.text(body, "cron");
        try {
            CronExpression.parse(cron);
        } catch (IllegalArgumentException invalid) {
            throw new NotificationFailure(400, "INVALID_CRON");
        }
        Map<String, Object> config = object(body, "config");
        store.update("UPDATE jobs SET enabled=?,cron=?,config=?::jsonb,updated_at=now() WHERE id=?",
                enabled, cron, Json.write(config), id);
        audit.record(actor, "jobs.updated", id, Map.of("enabled", enabled, "cron", cron));
        return Map.of("id", id, "enabled", enabled, "cron", cron);
    }

    private Map<String, Object> putTemplate(String actor, String id, Map<String, Object> body) {
        String kind = Json.text(body, "kind");
        String locale = Json.text(body, "locale");
        if (!LOCALES.contains(locale)) {
            throw new NotificationFailure(400, "INVALID_LOCALE");
        }
        if (!id.equals(kind + "." + locale)) {
            throw new NotificationFailure(400, "TEMPLATE_ID_MISMATCH");
        }
        Map<String, Object> catalog = store.one("SELECT id,silent FROM kinds WHERE id=?", kind);
        if (catalog == null) {
            throw new NotificationFailure(404, "UNKNOWN_NOTIFICATION_KIND");
        }
        String title = Json.nullableText(body, "title");
        String text = Json.text(body, "body");
        boolean enabled = Json.bool(body, "enabled");
        // 새 템플릿은 «실제로 렌더되는지» 확인한 뒤에만 저장한다. 문법만 봐서는 인자 누락을 못 잡는다.
        Map<String, Object> draft = new LinkedHashMap<>();
        draft.put("kind", kind);
        draft.put("locale", locale);
        draft.put("title", title);
        draft.put("body", text);
        draft.put("silent", catalog.get("silent"));
        renderDraft(draft, object(body, "sampleParams"));
        store.update("INSERT INTO templates(id,kind,locale,title,body,enabled,version) VALUES(?,?,?,?,?,?,1)"
                + " ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,locale=EXCLUDED.locale,title=EXCLUDED.title,"
                + "body=EXCLUDED.body,enabled=EXCLUDED.enabled,version=templates.version+1",
                id, kind, locale, title, text, enabled);
        long version = ((Number) store.one("SELECT version FROM templates WHERE id=?", id).get("version")).longValue();
        audit.record(actor, "templates.updated", id, Map.of("kind", kind, "locale", locale, "version", version));
        return Map.of("id", id, "version", version, "enabled", enabled);
    }

    private Map<String, Object> putDeeplink(String actor, String id, Map<String, Object> body) {
        if (store.one("SELECT id FROM kinds WHERE id=?", id) == null) {
            throw new NotificationFailure(404, "UNKNOWN_NOTIFICATION_KIND");
        }
        String url = Json.nullableText(body, "urlTemplate");
        Map<String, Object> data = object(body, "dataTemplate");
        Map<String, Object> sample = object(body, "sampleParams");
        for (Map.Entry<String, Object> entry : data.entrySet()) {
            if (!(entry.getValue() instanceof String)) {
                throw new NotificationFailure(400, "INVALID_dataTemplate");
            }
            format(entry.getValue().toString(), sample);
        }
        if (url != null) {
            format(url, sample);
        }
        store.update("INSERT INTO deeplinks(id,url_template,data_template) VALUES(?,?,?::jsonb)"
                + " ON CONFLICT(id) DO UPDATE SET url_template=EXCLUDED.url_template,"
                + "data_template=EXCLUDED.data_template", id, url, Json.write(data));
        audit.record(actor, "deeplinks.updated", id, Map.of("keys", new ArrayList<>(new TreeSet<>(data.keySet()))));
        return Map.of("id", id, "keys", new ArrayList<>(new TreeSet<>(data.keySet())));
    }

    // ── 렌더 검증 ───────────────────────────────────────────────────────

    RenderedPush renderDraft(Map<String, Object> template, Map<String, Object> params) {
        try {
            RenderedPush push = renderer.renderTemplate(template, params);
            FcmPayload.requireFits(push, true, "template-preview");
            return push;
        } catch (IllegalArgumentException invalid) {
            throw new NotificationFailure(400, "INVALID_TEMPLATE_SYNTAX");
        }
    }

    private static void format(String pattern, Map<String, Object> params) {
        try {
            Renderer.format(pattern, "ko", params);
        } catch (IllegalArgumentException invalid) {
            throw new NotificationFailure(400, "INVALID_TEMPLATE_SYNTAX");
        }
    }

    // ── 입력 해석 ───────────────────────────────────────────────────────

    static Map<String, Object> object(Map<String, Object> body, String key) {
        if (!(body.get(key) instanceof Map<?, ?>)) {
            throw new NotificationFailure(400, "INVALID_" + key);
        }
        return Json.map(body.get(key));
    }

    static UUID uuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (RuntimeException invalid) {
            throw new NotificationFailure(400, "INVALID_USER_ID");
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static String status(String requested) {
        if (requested == null || requested.isBlank()) {
            return null;
        }
        return switch (requested) {
            case "PENDING", "DEFERRED", "SENT", "SUPPRESSED", "FAILED" -> requested;
            default -> throw new NotificationFailure(400, "INVALID_STATUS");
        };
    }

    static String instant(Object value) {
        return value == null ? null : ((Timestamp) value).toInstant().toString();
    }
}
