package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** 외부 발송은 이 클래스 한 곳만 호출한다. 게이트/소유권/ack의 잠금을 발송까지 유지한다. */
@Service
class DispatchService {

    /** 풀릴 시각을 알 수 없는 보류의 재확인 주기 — 상한을 점거하지 않을 만큼만 미룬다. */
    private static final int HOLD_SECONDS = 30;

    /**
     * 「묶음이 다 오기를 기다리는 중」 표식.
     *
     * <p>{@link #retry} 도 행을 {@code PENDING} 인 채로 미래 시각에 세워 둔다(전송 실패·기기 없음).
     * 표식 없이 «미래 시각인 PENDING» 을 전부 되돌리면 그 재시도 backoff 까지 취소해, 실패한 행을
     * 매 tick 다시 때린다. 그래서 이 대기만 표식으로 갈라내고, 되돌릴 때 표식을 지운다.
     */
    private static final String INCOMPLETE = "BUNDLE_INCOMPLETE";

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
        Bundles.Family family = Bundles.of(first.get("kind"));
        if (family == null || first.get("admin_actor") != null || first.get("slot_at") == null
                || first.get("group_id") == null) {
            return List.of(first);
        }
        // 결과 슬롯은 15분 버킷이 닫힌 뒤에만 flush. 모집·종료의 slot은 원래 예정 발송 시각이다.
        if (family.waitsForSlotClose()) {
            Instant closesAt = ((Timestamp) first.get("slot_at")).toInstant()
                    .plusSeconds(Bundles.RESULT_SLOT_SECONDS);
            if (closesAt.isAfter(clock.instant())) {
                holdUntil((UUID) first.get("id"), closesAt);
                return List.of();
            }
        }
        // 상태를 가리지 않고 «축 전체»를 읽는다 — 이미 나간 형제까지 세어야 배치가 다 왔는지 알 수 있다.
        // 실제로 보낼 행은 아래 FOR UPDATE 가 상태·시각으로 다시 고른다.
        List<Map<String, Object>> axis = store.rows("SELECT * FROM deliveries"
                + " WHERE user_id=? AND group_id=? AND slot_at=? AND admin_actor IS NULL AND " + family.predicate()
                + " ORDER BY " + family.order(),
                first.get("user_id"), first.get("group_id"), first.get("slot_at"));
        Set<String> declared = declaredMembers(axis);
        if (!declared.isEmpty()) {
            if (!arrived(axis).containsAll(declared)) {
                // 아직 다 오지 않았다 — «보내지 않고» 뒤로 물린다. 뒤에 선 다른 후보는 그동안 흐른다.
                parkForBatch((UUID) first.get("id"));
                return List.of();
            }
            releaseParked(first, family);
        }
        return axis;
    }

    /**
     * 이 묶음 축에 «어떤 사건들이 올 것»이라고 발송부가 적어 보냈는지 — 기대 대상 id 의 합집합.
     *
     * <p>구 경로의 보장은 「한 배치당 (유저 × 그룹) 한 건」이었다. 신 경로는 그 한 건을 사건 N 개로
     * 쪼개 보내므로, <b>첫 사건만 도착한 사이에 flush 가 끼면 같은 배치가 두 번 나간다</b> — 수신
     * 순서나 relay 의 전달 원자성에 기댈 수 없는 지점이다.
     *
     * <p>개수가 아니라 <b>id 집합</b>으로 판정한다. (유저 × 그룹 × 그날) 축에는 하루 동안 여러 배치가
     * 겹쳐 들어오므로 「몇 건 왔나」는 완전성의 증거가 되지 못한다. 합집합을 쓰는 것은 뒤 배치가
     * 대상을 더할 수 있기 때문이고, 앞 배치가 선언한 대상은 그대로 남아야 하기 때문이다.
     *
     * @param axis 묶음 축의 모든 행(상태 무관)
     * @return 기대 대상 id — 아무도 선언하지 않았으면 빈 집합(기다리지 않는다)
     */
    private static Set<String> declaredMembers(List<Map<String, Object>> axis) {
        Set<String> declared = new LinkedHashSet<>();
        for (Map<String, Object> row : axis) {
            if (Json.map(row.get("payload").toString()).get("bundleMembers") instanceof List<?> members) {
                members.stream().filter(Objects::nonNull).map(Object::toString).forEach(declared::add);
            }
        }
        return declared;
    }

    /**
     * @param axis 묶음 축의 모든 행
     * @return 실제로 도착한 대상 id — 이미 나갔거나({@code SENT}) 걸러진({@code SUPPRESSED}) 형제도
     *     «수신은 됐다». 상태로 거르면 같은 배치가 영원히 미달로 남는다
     */
    private static Set<String> arrived(List<Map<String, Object>> axis) {
        Set<String> received = new LinkedHashSet<>();
        for (Map<String, Object> row : axis) {
            if (row.get("subject_id") != null) {
                received.add(row.get("subject_id").toString());
            }
        }
        return received;
    }

    /**
     * 배치를 기다리느라 «세워 둔» 형제를 다시 세운다 — {@link #INCOMPLETE} 표식이 붙은 행만.
     *
     * <p>기다림은 후보 상한을 비우려고 {@code next_attempt_at} 을 미뤄 둔 것이다. 배치가 다 온 순간
     * 그 시각을 되돌리지 않으면 마지막에 도착한 사건만 발송 대상이 되어, 정작 <b>대표가 빠진 채</b>
     * 한 건이 나간다 — 유실분이 DLT 로 되돌아온 복구 경로가 정확히 그 모양이다.
     *
     * <p>표식이 없는 미래 시각은 되돌리지 않는다: 조용한 시간 이월({@code DEFERRED})은 정책이고,
     * 전송 실패·기기 없음의 재시도 backoff 는 <b>아직 기다려야 할 시간</b>이다.
     */
    private void releaseParked(Map<String, Object> first, Bundles.Family family) {
        store.update("UPDATE deliveries SET next_attempt_at=?,last_error=NULL"
                + " WHERE user_id=? AND group_id=? AND slot_at=? AND admin_actor IS NULL AND " + family.predicate()
                + " AND status='PENDING' AND last_error=?",
                Timestamp.from(clock.instant()), first.get("user_id"), first.get("group_id"),
                first.get("slot_at"), INCOMPLETE);
    }

    /**
     * 묶음이 다 오기를 기다리며 이 행을 뒤로 물린다 — 표식을 남겨 재시도 backoff 와 갈라 둔다.
     *
     * <p>{@code next_attempt_at<=now} 인 행, 즉 «지금 후보로 선 행»만 물린다. 이미 미래에 세워진 행은
     * 재시도 backoff 중이므로 건드리지 않는다 — 그래야 되돌릴 때도 그 backoff 를 깨지 않는다.
     * 시도 횟수는 올리지 않는다. 기다림은 실패가 아니다.
     */
    private void parkForBatch(UUID id) {
        Timestamp now = Timestamp.from(clock.instant());
        store.update("UPDATE deliveries SET next_attempt_at=?,last_error=? WHERE id=?"
                + " AND status='PENDING' AND next_attempt_at<=?",
                Timestamp.from(clock.instant().plusSeconds(HOLD_SECONDS)), INCOMPLETE, id, now);
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
            Map<String, Object> ack = store.one("SELECT state,held_until FROM result_ack"
                    + " WHERE user_id=? AND session_id=?", user, UUID.fromString(subject));
            if (ack != null && !"RELEASED".equals(ack.get("state"))) {
                if ("CONFIRMED".equals(ack.get("state"))) {
                    suppress(id);
                    return false;
                }
                // 보류는 «아직 못 보낸다»이지 실패가 아니다. 그대로 두면 이 행이 후보 상한을 계속 점거해
                // 뒤에 선 다른 사용자의 알림과 BET_SILENT_FLUSH 까지 보류가 풀릴 때까지 굶는다.
                // HELD 는 만료 시각까지, 판정 대기(NEEDS_CONFIRM)는 리컨실 주기만큼 이월한다.
                Timestamp until = (Timestamp) ack.get("held_until");
                holdUntil(id, until == null ? clock.instant().plusSeconds(HOLD_SECONDS) : until.toInstant());
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
        Bundles.Family family = Bundles.of(first.get("kind"));
        // 묶음 축과 같은 조건이라야 한다 — 여기만 넓으면 묶이지도 않은 서로 다른 알림이 같은 collapse
        // 키로 나가 트레이에서 서로를 덮는다.
        if (family == null || first.get("slot_at") == null || first.get("admin_actor") != null
                || first.get("group_id") == null) {
            return first.get("event_id").toString();
        }
        return "bundle:" + first.get("user_id") + ":" + first.get("group_id") + ":" + family.id()
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

    /**
     * 아직 «보낼 수 없을 뿐»인 행을 실제 발송 가능 시각으로 이월한다.
     *
     * <p>{@link #retry}와 달리 {@code attempts}·{@code last_error}를 건드리지 않는다 — 실패가 아니라
     * 기다림이다. 이월하지 않으면 그 행이 후보 정렬(next_attempt_at,id)의 앞자리를 계속 차지해,
     * 상한 25건이 그런 행으로 채워지는 순간 <b>뒤에 선 모든 사용자</b>의 발송이 멈춘다.
     */
    private void holdUntil(UUID id, Instant until) {
        Instant target = until.isAfter(clock.instant()) ? until : clock.instant().plusSeconds(HOLD_SECONDS);
        store.update("UPDATE deliveries SET next_attempt_at=GREATEST(next_attempt_at,?) WHERE id=?"
                + " AND status IN ('PENDING','DEFERRED')", Timestamp.from(target), id);
    }

    private void suppress(UUID id) {
        store.update("UPDATE deliveries SET status='SUPPRESSED' WHERE id=?", id);
    }

    private void retry(UUID id, String reason) {
        store.update("UPDATE deliveries SET attempts=attempts+1,last_error=?,next_attempt_at=? WHERE id=?",
                reason, Timestamp.from(clock.instant().plusSeconds(60)), id);
    }
}
