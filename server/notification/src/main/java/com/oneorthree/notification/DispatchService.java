package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.UUID;

/** 외부 발송은 이 클래스 한 곳만 호출한다. 게이트/소유권/ack의 잠금을 발송까지 유지한다. */
@Service
class DispatchService {

    private final Store store;
    private final SettingsService settings;
    private final DataClient data;
    private final Renderer renderer;
    private final PushTransport transport;
    private final Clock clock;

    DispatchService(Store store, SettingsService settings, DataClient data, Renderer renderer,
            PushTransport transport, Clock clock) {
        this.store = store;
        this.settings = settings;
        this.data = data;
        this.renderer = renderer;
        this.transport = transport;
        this.clock = clock;
    }

    List<UUID> candidates() {
        return store.rows("SELECT id FROM deliveries WHERE status IN ('PENDING','DEFERRED')"
                + " AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 25", Timestamp.from(clock.instant()))
                .stream().map(row -> (UUID) row.get("id")).toList();
    }

    @Transactional(timeout = 60)
    public void dispatch(UUID id) {
        Map<String, Object> gate = store.one("SELECT enabled FROM dispatch_control WHERE id=1 FOR SHARE");
        if (gate == null || !Boolean.TRUE.equals(gate.get("enabled"))) {
            return;
        }
        store.lock("device-ownership");
        Map<String, Object> candidate = store.one("SELECT * FROM deliveries WHERE id=?", id);
        if (candidate == null) {
            return;
        }
        List<Map<String, Object>> rows = bundleCandidates(candidate);
        // 고정 순서: gate → device → ack → delivery. prepare와 flush가 같은 사건 잠금을 쓴다.
        for (Map<String, Object> row : rows) {
            if ("BET_RESULT".equals(row.get("kind")) && row.get("subject_id") != null) {
                store.lock("ack:" + row.get("user_id") + ":" + row.get("subject_id"));
            }
        }
        List<Map<String, Object>> ready = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> delivery = store.one("SELECT * FROM deliveries WHERE id=?"
                    + " AND status IN ('PENDING','DEFERRED') AND next_attempt_at<=? FOR UPDATE SKIP LOCKED",
                    row.get("id"), Timestamp.from(clock.instant()));
            if (delivery != null && eligible(delivery)) {
                ready.add(delivery);
            }
        }
        if (ready.isEmpty()) {
            return;
        }
        deliver(ready);
    }

    private List<Map<String, Object>> bundleCandidates(Map<String, Object> first) {
        String kind = first.get("kind").toString();
        if (first.get("admin_actor") != null || first.get("slot_at") == null || first.get("group_id") == null
                || !Set.of("BET_RESULT", "BET_VOID_REFUND", "CHALLENGE_SESSION_OPEN").contains(kind)) {
            return List.of(first);
        }
        // 결과 슬롯은 15분 버킷이 닫힌 뒤에만 flush. 모집의 slot은 원래 예정 발송 시각이다.
        if (!"CHALLENGE_SESSION_OPEN".equals(kind)
                && ((Timestamp) first.get("slot_at")).toInstant().plusSeconds(900).isAfter(clock.instant())) {
            return List.of();
        }
        String family = "CHALLENGE_SESSION_OPEN".equals(kind)
                ? "kind='CHALLENGE_SESSION_OPEN'" : "kind IN ('BET_RESULT','BET_VOID_REFUND')";
        return store.rows("SELECT * FROM deliveries WHERE user_id=? AND group_id=? AND slot_at=?"
                + " AND admin_actor IS NULL AND " + family
                + " AND status IN ('PENDING','DEFERRED') AND next_attempt_at<=? ORDER BY subject_id,id",
                first.get("user_id"), first.get("group_id"), first.get("slot_at"), Timestamp.from(clock.instant()));
    }

    private boolean eligible(Map<String, Object> delivery) {
        UUID id = (UUID) delivery.get("id");
        UUID user = (UUID) delivery.get("user_id");
        String kind = delivery.get("kind").toString();
        String subject = (String) delivery.get("subject_id");
        Map<String, Object> catalog = store.one("SELECT * FROM kinds WHERE id=?", kind);
        Map<String, Object> fence = store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", user);
        if (catalog == null || !Boolean.TRUE.equals(catalog.get("enabled"))
                || (fence != null && Boolean.TRUE.equals(fence.get("withdrawn")))) {
            suppress(id);
            return false;
        }
        if ("BET_RESULT".equals(kind) && subject != null) {
            Map<String, Object> ack = store.one("SELECT state FROM result_ack WHERE user_id=? AND session_id=?",
                    user, UUID.fromString(subject));
            if (ack != null && !"RELEASED".equals(ack.get("state"))) {
                if ("CONFIRMED".equals(ack.get("state"))) {
                    suppress(id);
                }
                return false;
            }
        }
        Map<String, Object> preferences = settings.read(user);
        Map<String, Object> params = Json.map(delivery.get("payload").toString());
        boolean silent = Boolean.TRUE.equals(catalog.get("silent"));
        if (!silent && !Boolean.TRUE.equals(preferences.get("notificationEnabled"))) {
            suppress(id);
            return false;
        }
        if (!silent && !"BYPASS".equals(catalog.get("quiet_policy"))) {
            Instant quietEnd = QuietHours.endIfQuiet(preferences, clock.instant());
            if (quietEnd != null) {
                deferOrSuppress(id, catalog, params, quietEnd);
                return false;
            }
        }
        if (Boolean.TRUE.equals(catalog.get("eligibility_required"))
                && !data.eligible(user, kind, subject, params)) {
            suppress(id);
            return false;
        }
        int cooldown = ((Number) catalog.get("cooldown_seconds")).intValue();
        if (cooldown > 0 && store.one("SELECT id FROM deliveries WHERE user_id=? AND kind=? AND status='SENT'"
                + " AND sent_at>? LIMIT 1", user, kind,
                Timestamp.from(clock.instant().minusSeconds(cooldown))) != null) {
            suppress(id);
            return false;
        }
        return true;
    }

    private void deliver(List<Map<String, Object>> ready) {
        UUID user = (UUID) ready.get(0).get("user_id");
        boolean sound = Boolean.TRUE.equals(settings.read(user).get("soundEnabled"));
        List<Map<String, Object>> tokens = store.rows("SELECT device_token,ownership_token FROM device_tokens"
                + " WHERE user_id=? AND active ORDER BY device_token", user);
        if (tokens.isEmpty()) {
            ready.forEach(row -> retry((UUID) row.get("id"), "NO_ACTIVE_DEVICE"));
            return;
        }
        boolean failed = false;
        for (Map<String, Object> token : tokens) {
            UUID ownership = (UUID) token.get("ownership_token");
            List<Map<String, Object>> unsent = ready.stream().filter(row -> store.one(
                    "SELECT 1 FROM delivery_devices WHERE delivery_id=? AND ownership_token=?",
                    row.get("id"), ownership) == null).toList();
            if (unsent.isEmpty()) {
                continue;
            }
            RenderedPush push = renderer.renderBundle(unsent);
            PushTransport.Result result = transport.send(token.get("device_token").toString(), push, sound,
                    collapseEventId(ready));
            if (result == PushTransport.Result.SENT) {
                for (Map<String, Object> row : unsent) {
                    store.update("INSERT INTO delivery_devices(delivery_id,ownership_token) VALUES(?,?)"
                            + " ON CONFLICT DO NOTHING", row.get("id"), ownership);
                }
            } else if (result == PushTransport.Result.UNREGISTERED) {
                store.update("UPDATE device_tokens SET active=false,updated_at=now()"
                        + " WHERE device_token=? AND ownership_token=?", token.get("device_token"), ownership);
            } else {
                failed = true;
            }
        }
        for (Map<String, Object> row : ready) {
            if (failed) {
                retry((UUID) row.get("id"), "FCM_RETRY");
            } else {
                store.update("UPDATE deliveries SET status='SENT',sent_at=?,attempts=attempts+1,"
                        + "last_error=NULL WHERE id=?",
                        Timestamp.from(clock.instant()), row.get("id"));
            }
        }
    }

    private String collapseEventId(List<Map<String, Object>> rows) {
        Map<String, Object> first = rows.get(0);
        if (first.get("slot_at") == null || first.get("admin_actor") != null
                || !Set.of("BET_RESULT", "BET_VOID_REFUND", "CHALLENGE_SESSION_OPEN").contains(first.get("kind"))) {
            return first.get("event_id").toString();
        }
        String family = "CHALLENGE_SESSION_OPEN".equals(first.get("kind")) ? "open" : "result";
        return "bundle:" + first.get("user_id") + ":" + first.get("group_id") + ":" + family
                + ":" + ((Timestamp) first.get("slot_at")).toInstant();
    }

    private void deferOrSuppress(UUID id, Map<String, Object> catalog, Map<String, Object> params, Instant quietEnd) {
        String deadline = Json.nullableText(params, "deferExpiresAt");
        if (!"DEFER".equals(catalog.get("quiet_policy"))
                || (deadline != null && !quietEnd.isBefore(Instant.parse(deadline)))) {
            suppress(id);
            return;
        }
        // slot_at은 원래 묶음 사건 축이다. 이월할 때 새로운 슬롯으로 덮지 않는다.
        store.update("UPDATE deliveries SET status='DEFERRED',next_attempt_at=? WHERE id=?",
                Timestamp.from(quietEnd), id);
    }

    /**
     * 후보 한 건의 실패를 «별도 트랜잭션»으로 내구화한다.
     *
     * <p>{@link #dispatch(UUID)} 가 예외로 끝나면 그 트랜잭션은 통째로 되감겨 {@code next_attempt_at}
     * 도 {@code attempts} 도 그대로다. 그 행은 다음 tick 에서도 같은 정렬로 후보 맨 앞에 다시 서고,
     * 그래서 한 종류의 템플릿 비활성화·렌더 입력 누락 하나가 «다른 종류·다른 사용자»의 정상 알림까지
     * 무기한 막는다. 재시도 시각을 밀어 두면 큐가 계속 흐른다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 30)
    public void backOff(UUID id, String reason) {
        retry(id, reason);
    }

    private void suppress(UUID id) {
        store.update("UPDATE deliveries SET status='SUPPRESSED' WHERE id=?", id);
    }

    private void retry(UUID id, String reason) {
        store.update("UPDATE deliveries SET attempts=attempts+1,last_error=?,next_attempt_at=? WHERE id=?",
                reason, Timestamp.from(clock.instant().plusSeconds(60)), id);
    }
}
