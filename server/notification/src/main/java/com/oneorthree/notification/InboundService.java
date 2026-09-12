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
    private final ResultBundleCompletion resultBundles;

    InboundService(Store store, DeviceService devices, SettingsService settings, ResultBundleCompletion resultBundles) {
        this.store = store;
        this.devices = devices;
        this.settings = settings;
        this.resultBundles = resultBundles;
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
                    deletionToken(params), rawOwnership(params),
                    Json.nullableNumber(params, "authGeneration"), Json.nullableText(params, "sessionId"),
                    Json.nullableText(params, "bootstrapNonceHash"));
            case "notification.settings.changed" -> settings.applyLocked(event.userId(), params, event.version());
            case "auth.session.revoked" -> devices.revokeSession(event.userId(), params);
            case "auth.generation.bumped" -> devices.generation(event.userId(),
                    Json.number(params, "authGeneration"), false);
            case "user.withdrawn" -> devices.generation(event.userId(),
                    Json.number(params, "authGeneration"), true);
            case "notification.requested" -> enqueue(event);
            case "notification.resultBundle.closed" -> resultBundles.accept(event);
            default -> {
                if (!PROJECTIONS.contains(event.type())) {
                    throw new NotificationFailure(422, "UNSUPPORTED_EVENT_TYPE");
                }
                project(event);
            }
        }
    }

    private static String deletionToken(Map<String, Object> params) {
        Object token = params.get("deviceToken");
        // 직접 DELETE와 같은 의미다. 공백 원문은 Data의 멱등 입력으로 보존되어 올 수 있다.
        return token instanceof String value && value.isBlank() ? null : Json.nullableText(params, "deviceToken");
    }

    /**
     * <b>이미 내구화된</b> 봉투의 소유권 값을 꺼낸다 — 형식 판정은 {@code DeviceService} 가 한다.
     *
     * <p>{@code Json.nullableText} 를 쓰면 안 된다: 그 함수는 빈 문자열·공백·문자열 아닌 값을
     * <b>400 으로 거절</b>하는데, 여기서 400 이 나면 relay 가 그 행을 영원히 재시도하고(A18 고갈
     * 처리 없음) 순서 축이 같은 <b>그 유저의 뒤 이벤트가 전부</b> 막힌다. 동기 경로에서는 그 거절이
     * 맞지만(앱이 고쳐 다시 보낼 수 있다), 봉투는 고칠 수가 없다.
     *
     * <p><b>{@code null} 로 접지도 않는다.</b> {@code null} 은 「CAS 검사 없음」이라는 다른 뜻이라,
     * 문자열이 아닌 값을 그리로 접으면 그 삭제가 소유권 검사를 잃고 지금 등록된 기기까지 지운다(㊚).
     * 그래서 {@code null} 만 「없음」으로 두고 나머지는 <b>있는 그대로</b> 넘긴다 — 정규 표기가
     * 아니면 {@code deleteLocked} 가 「어느 행에도 맞지 않는 소유권」으로 보고 무해하게 소비한다.
     */
    private static String rawOwnership(Map<String, Object> params) {
        Object value = params.get("ownershipToken");
        return value == null ? null : String.valueOf(value);
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
