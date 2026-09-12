package com.oneorthree.notification;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.sql.Timestamp;
import java.util.Map;
import java.util.UUID;

@Service
class AckService {

    private static final long RETRY_SECONDS = 30;

    private final Store store;
    private final DataClient data;
    private final Clock clock;
    private final TransactionTemplate transaction;

    AckService(Store store, DataClient data, Clock clock, PlatformTransactionManager manager) {
        this.store = store;
        this.data = data;
        this.clock = clock;
        this.transaction = new TransactionTemplate(manager);
        this.transaction.setTimeout(10);
    }

    /**
     * 결과 ack 의 보류/확정/중단.
     *
     * <p>응답 재생만으로 끝내지 않는다({@code reassert=true}). 첫 {@code prepare(K)} 뒤 Data ack 가
     * 실패하거나 프로세스가 죽으면 만료·리컨실이 그 보류를 {@code RELEASED} 로 푼다. 그 상태에서 앱이
     * «같은 Idempotency-Key» 로 재시도할 때 과거의 {@code HELD} 응답만 돌려주면, 아무것도 보호하지
     * 않는 채 Data ack 가 커밋되고 그 사이에 낀 flush 가 「이미 확인한 결과」를 푸시한다(A22 ⓓ).
     * 그래서 재생도 «같은 사건 잠금» 아래에서 현재 상태를 다시 읽고, CONFIRMED 가 아니면 이번 호출을
     * 보호하는 HELD 를 다시 세운다.
     */
    @Transactional
    public Map<String, Object> command(UUID user, UUID session, String action, String key) {
        return store.command("ack:" + user + ":" + session + ":" + action, key, Map.of("sessionId", session),
                () -> apply(user, session, action), true);
    }

    private Map<String, Object> apply(UUID user, UUID session, String action) {
        store.lock("ack:" + user + ":" + session);
        Map<String, Object> old = store.one("SELECT * FROM result_ack WHERE user_id=? AND session_id=? FOR UPDATE",
                user, session);
        if (old != null && "CONFIRMED".equals(old.get("state"))) {
            return Map.of("held", true, "state", "CONFIRMED");
        }
        String state = switch (action) {
            case "prepare" -> "HELD";
            case "commit" -> "CONFIRMED";
            case "abort" -> "NEEDS_CONFIRM";
            default -> throw new NotificationFailure(400, "INVALID_ACK_ACTION");
        };
        // abort도 정본 확인 전에는 해제하지 않는다. 응답 유실로 실제 Data commit일 수 있다.
        store.update("INSERT INTO result_ack(user_id,session_id,state,held_until) VALUES(?,?,?,?)"
                + " ON CONFLICT(user_id,session_id) DO UPDATE SET state=EXCLUDED.state,"
                + "held_until=EXCLUDED.held_until,updated_at=now(),next_reconcile_at=NULL", user, session, state,
                "HELD".equals(state) ? Timestamp.from(clock.instant().plusSeconds(30)) : null);
        if ("CONFIRMED".equals(state)) {
            suppress(user, session);
        }
        return Map.of("held", true, "state", state);
    }

    public void reconcile() {
        store.update("UPDATE result_ack SET state='NEEDS_CONFIRM',next_reconcile_at=NULL"
                + " WHERE state='HELD' AND held_until<=?",
                Timestamp.from(clock.instant()));
        RuntimeException lastFailure = null;
        for (Map<String, Object> row : store.rows("SELECT user_id,session_id FROM result_ack"
                + " WHERE state='NEEDS_CONFIRM' AND (next_reconcile_at IS NULL OR next_reconcile_at<=?)"
                + " ORDER BY COALESCE(next_reconcile_at,updated_at),user_id,session_id LIMIT 25",
                Timestamp.from(clock.instant()))) {
            UUID user = (UUID) row.get("user_id");
            UUID session = (UUID) row.get("session_id");
            try {
                RuntimeException failure = transaction.execute(ignored -> reconcileOne(user, session));
                if (failure != null) {
                    lastFailure = failure;
                }
            } catch (RuntimeException failure) {
                lastFailure = failure;
            }
        }
        if (lastFailure != null) {
            throw lastFailure;
        }
    }

    private RuntimeException reconcileOne(UUID user, UUID session) {
        store.lock("ack:" + user + ":" + session);
        Map<String, Object> pending = store.one("SELECT state FROM result_ack WHERE user_id=? AND session_id=?"
                + " AND state='NEEDS_CONFIRM' AND (next_reconcile_at IS NULL OR next_reconcile_at<=?)"
                + " FOR UPDATE SKIP LOCKED", user, session, Timestamp.from(clock.instant()));
        if (pending == null) {
            return null;
        }
        boolean acknowledged;
        try {
            acknowledged = data.acknowledged(user, session);
        } catch (RuntimeException failure) {
            // 이 TX 안에서 잡아야 예약도 롤백되지 않는다. 억제는 유지하고 다음 대상에 차례를 준다.
            // prepare/commit/abort도 같은 사건 잠금을 쓰므로 새 ack의 상태·예약을 뒤늦게 덮지 않는다.
            store.update("UPDATE result_ack SET next_reconcile_at=? WHERE user_id=? AND session_id=?",
                    Timestamp.from(clock.instant().plusSeconds(RETRY_SECONDS)), user, session);
            return failure;
        }
        store.update("UPDATE result_ack SET state=?,updated_at=now(),next_reconcile_at=NULL"
                + " WHERE user_id=? AND session_id=?",
                acknowledged ? "CONFIRMED" : "RELEASED", user, session);
        if (acknowledged) {
            suppress(user, session);
        }
        return null;
    }

    private void suppress(UUID user, UUID session) {
        store.update("UPDATE deliveries SET status='SUPPRESSED' WHERE user_id=? AND kind='BET_RESULT'"
                + " AND subject_id=? AND status IN ('PENDING','DEFERRED')",
                user, session.toString());
    }
}
