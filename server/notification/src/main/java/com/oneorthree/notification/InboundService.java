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

    private static final Set<String> PROJECTIONS = Set.of(
            "user.updated", "friend.request.resolved", "user.displayNameChanged");
    /**
     * 수신 멱등 해시(GROMO-2212). jsonb 로 캐스트해 키 순서·공백을 정규화한 텍스트의 SHA-256 이라 같은 의미의
     * 봉투는 같은 값이다. 저장·재전달 비교·V11 백필({@code envelope::text})이 모두 이 식을 쓴다 — 탈퇴로
     * 원문을 지운 뒤에도 이 값만으로 중복과 {@code EVENT_ID_CONFLICT} 를 가른다.
     */
    static final String ENVELOPE_HASH = "encode(sha256(convert_to((?::jsonb)::text,'UTF8')),'hex')";
    /** 수신 응답 본문 — 새 반영이든 같은 봉투의 재전달이든 같다. */
    static final Map<String, Object> ACCEPTED = Map.of("accepted", true);
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
        receive(body, InboundTrace.NONE);
        return ACCEPTED;
    }

    /**
     * {@link #accept} 와 같은 처리에 수신 원인 문맥을 더한다(GROMO-2557). 문맥은 발송 작업 행의 별도 열에만 남고
     * {@code envelope_hash} 대상 본문·멱등 판정은 그대로다.
     *
     * @param body  봉투
     * @param trace 헤더에서 읽은 원인 문맥 — 없으면 {@link InboundTrace#NONE}
     * @return 새로 반영했으면 {@code true}, 같은 봉투의 재전달이면 {@code false}
     */
    @Transactional
    public boolean receive(Map<String, Object> body, InboundTrace trace) {
        Envelope event = Envelope.read(body);
        String envelope = Json.write(body);
        store.lock("inbound:" + event.eventId());
        Map<String, Object> existing = store.one("SELECT envelope_hash=" + ENVELOPE_HASH + " AS same"
                + " FROM inbound_events WHERE event_id=?", envelope, event.eventId());
        if (existing != null) {
            if (!Boolean.TRUE.equals(existing.get("same"))) {
                throw new NotificationFailure(409, "EVENT_ID_CONFLICT");
            }
            // 재전달은 기존 행(발송 작업의 origin 포함)을 건드리지 않는다 — 다른 헤더로 와도 최초 문맥이 남는다.
            return false;
        }
        apply(event, trace);
        // 탈퇴 TX 와 같은 user-state 잠금 아래서 fence 를 읽는다. 잠금 없이 여기까지 오는 경로(deleteLocked 의
        // 조기 소비)도 탈퇴가 먼저 커밋됐으면 원문 없이 적고, 나중이면 탈퇴가 대기 뒤 이 행의 원문을 지운다.
        // device-ownership 은 더 잡지 않는다 — 잡으면 SettingsService.live 경로와 잠금 순서가 뒤집힌다.
        store.lock("user-state:" + event.userId());
        Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", event.userId());
        boolean withdrawn = fence != null && Boolean.TRUE.equals(fence.get("withdrawn"));
        store.update("INSERT INTO inbound_events(event_id,user_id,envelope_hash,envelope) VALUES(?,?,"
                + ENVELOPE_HASH + ",?::jsonb)", event.eventId(), event.userId(), envelope, withdrawn ? null : envelope);
        return true;
    }

    /**
     * 같은 봉투의 재전달 로그용 — 처음 수신 때 발송 작업 행에 적은 origin. 행이 없으면(발송 요청이 아닌 이벤트) {@code null}.
     * 값은 {@link InboundTrace#safeId} 를 다시 거친다.
     */
    Map<String, Object> firstOrigin(String eventId) {
        return store.one("SELECT origin_request_id,origin_trace_id FROM deliveries WHERE event_id=?", eventId);
    }

    private void apply(Envelope event, InboundTrace trace) {
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
            case "notification.requested" -> enqueue(event, trace);
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

    void enqueue(Envelope event, InboundTrace trace) {
        store.lock("device-ownership");
        String kind = Json.text(event.params(), "kind");
        Map<String, Object> catalog = store.one("SELECT id FROM kinds WHERE id=?", kind);
        if (catalog == null) {
            throw new NotificationFailure(422, "UNKNOWN_NOTIFICATION_KIND");
        }
        Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", event.userId());
        if (fence != null && Boolean.TRUE.equals(fence.get("withdrawn"))) {
            // 탈퇴자의 발송 로그는 파기 대상이다 — 억제 행으로라도 새로 남기지 않는다(GROMO-1943).
            return;
        }
        String group = Json.nullableText(event.params(), "groupId");
        String slot = Json.nullableText(event.params(), "slotAt");
        // 원인 문맥(V16)은 발송 작업 행에 한 번 적는다. 충돌이면 DO NOTHING 이라 기존 행의 origin 을 덮지 않는다.
        store.update("INSERT INTO deliveries(id,event_id,user_id,kind,subject_id,group_id,slot_at,payload,locale,"
                + "status,next_attempt_at,origin_request_id,origin_trace_id)"
                + " VALUES(?,?,?,?,?,?,?,?::jsonb,?,?,COALESCE(?,now()),?,?) ON CONFLICT DO NOTHING",
                UUID.randomUUID(), event.eventId(), event.userId(), kind, event.subjectId(),
                group == null ? null : UUID.fromString(group),
                slot == null ? null : Timestamp.from(java.time.Instant.parse(slot)), Json.write(event.params()),
                event.locale(), "PENDING",
                event.scheduledAt() == null ? null : Timestamp.from(event.scheduledAt()),
                trace.originRequestId(), trace.originTraceId());
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
