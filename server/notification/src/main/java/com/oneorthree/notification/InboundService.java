package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Kafka/HTTP 공통 수신. 상태 반영과 수신 멱등 마커를 하나의 DB 커밋으로 묶는다. */
@Service
class InboundService {

    private static final Set<String> PROJECTIONS = Set.of("user.updated", "challenge.updated", "bet.updated",
            "participation.updated", "friend.request.resolved", "user.displayNameChanged");
    private final Store store;
    private final DeviceService devices;
    private final SettingsService settings;

    InboundService(Store store, DeviceService devices, SettingsService settings) {
        this.store = store;
        this.devices = devices;
        this.settings = settings;
    }

    @Transactional
    public Map<String, Object> accept(Map<String, Object> body) {
        Envelope event = Envelope.read(body);
        store.lock("inbound:" + event.eventId());
        Map<String, Object> existing = store.one("SELECT envelope::text FROM inbound_events WHERE event_id=?",
                event.eventId());
        if (existing != null) {
            if (!Json.hash(Json.map(existing.get("envelope"))).equals(Json.hash(body))) {
                throw new NotificationFailure(409, "EVENT_ID_CONFLICT");
            }
            return Map.of("accepted", true);
        }
        apply(event);
        store.update("INSERT INTO inbound_events(event_id,envelope) VALUES(?,?::jsonb)",
                event.eventId(), Json.write(body));
        return Map.of("accepted", true);
    }

    private void apply(Envelope event) {
        Map<String, Object> params = event.params();
        switch (event.type()) {
            case "notification.deviceToken.deleted" -> devices.deleteLocked(event.userId(),
                    Json.nullableText(params, "deviceToken"), Json.nullableText(params, "ownershipToken"),
                    Json.nullableNumber(params, "authGeneration"));
            case "notification.settings.changed" -> settings.applyLocked(event.userId(), params, event.version());
            case "auth.session.revoked" -> devices.revokeSession(event.userId(), params);
            case "auth.generation.bumped" -> devices.generation(event.userId(),
                    Json.number(params, "authGeneration"), false);
            case "user.withdrawn" -> devices.generation(event.userId(),
                    Json.number(params, "authGeneration"), true);
            case "notification.requested" -> enqueue(event);
            default -> {
                if (!PROJECTIONS.contains(event.type())) {
                    throw new NotificationFailure(422, "UNSUPPORTED_EVENT_TYPE");
                }
                project(event);
            }
        }
    }

    void enqueue(Envelope event) {
        store.lock("device-ownership");
        String kind = Json.text(event.params(), "kind");
        Map<String, Object> catalog = store.one("SELECT id FROM kinds WHERE id=?", kind);
        if (catalog == null) {
            throw new NotificationFailure(422, "UNKNOWN_NOTIFICATION_KIND");
        }
        Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", event.userId());
        boolean withdrawn = fence != null && Boolean.TRUE.equals(fence.get("withdrawn"));
        String group = Json.nullableText(event.params(), "groupId");
        String slot = Json.nullableText(event.params(), "slotAt");
        store.update("INSERT INTO deliveries(id,event_id,user_id,kind,subject_id,group_id,slot_at,payload,locale,"
                + "status,next_attempt_at) VALUES(?,?,?,?,?,?,?,?::jsonb,?,?,COALESCE(?,now())) ON CONFLICT DO NOTHING",
                UUID.randomUUID(), event.eventId(), event.userId(), kind, event.subjectId(),
                group == null ? null : UUID.fromString(group),
                slot == null ? null : Timestamp.from(java.time.Instant.parse(slot)), Json.write(event.params()),
                event.locale(), withdrawn ? "SUPPRESSED" : "PENDING",
                event.scheduledAt() == null ? null : Timestamp.from(event.scheduledAt()));
    }

    private void project(Envelope event) {
        // 탈퇴 tombstone과 같은 잠금: 늦은 projection이 개인정보를 되살리지 못한다.
        store.lock("device-ownership");
        Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", event.userId());
        if (fence != null && Boolean.TRUE.equals(fence.get("withdrawn"))) {
            return;
        }
        store.update("INSERT INTO projections(projection_type,user_id,subject_id,version,payload)"
                + " VALUES(?,?,?,?,?::jsonb) ON CONFLICT(projection_type,user_id,subject_id)"
                + " DO UPDATE SET version=EXCLUDED.version,payload=EXCLUDED.payload"
                + " WHERE projections.version<EXCLUDED.version", event.type(), event.userId(),
                event.subjectId() == null ? "" : event.subjectId(), event.version(), Json.write(event.params()));
    }
}
