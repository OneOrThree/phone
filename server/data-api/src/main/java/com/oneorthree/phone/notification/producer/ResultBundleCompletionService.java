package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.notification.config.NotificationDispatchProperties;
import com.oneorthree.phone.common.port.BetSettlementClock;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 결과 슬롯 완료의 정본. 생산은 슬롯 공유 잠금을 커밋까지 유지하며, 마감은 배타 잠금 아래
 * 불변 기대 집합만 저장한다. USER 잠금을 얻는 outbox 발행은 마감 트랜잭션이 끝난 뒤 실행한다.
 */
@Service
public class ResultBundleCompletionService implements BetSettlementClock {

    public static final String EVENT_TYPE = "notification.resultBundle.closed";
    private static final long SLOT_SECONDS = 900;
    private final JdbcTemplate jdbc;
    private final NotificationDispatchProperties properties;
    private final OutboxCommandPort outbox;
    private final TransactionTemplate transaction;

    public ResultBundleCompletionService(JdbcTemplate jdbc, NotificationDispatchProperties properties,
            OutboxCommandPort outbox, PlatformTransactionManager manager) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.outbox = outbox;
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setTimeout(30);
    }

    /** 잠금 대기 뒤의 DB 시각을 사용한다. 기다리던 정산이 이미 닫힌 과거 슬롯을 확장하지 않는다. */
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public Instant settlementTime(UUID group) {
        if (!properties.isOutboxMode()) {
            return Instant.now();
        }
        while (true) {
            Instant candidate = databaseNow();
            Instant slot = slotOf(candidate);
            lock(group, slot, true);
            Instant after = databaseNow();
            if (slot.equals(slotOf(after)) && !sealed(group, slot)) {
                return after;
            }
        }
    }

    /** 재훑기도 같은 잠금에 참여한다. 이미 봉인된 집합에 없는 옛 사건은 조용히 추가하지 않는다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void protect(NotificationRequest request) {
        if (request.kind() != NotificationKind.BET_RESULT && request.kind() != NotificationKind.BET_VOID_REFUND) {
            return;
        }
        if (request.groupId() == null || request.slotAt() == null) {
            throw new IllegalArgumentException("결과 묶음에는 groupId와 slotAt이 필요합니다");
        }
        lock(request.groupId(), request.slotAt(), true);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void register(NotificationRequest request, String eventId) {
        if (request.kind() == NotificationKind.BET_RESULT || request.kind() == NotificationKind.BET_VOID_REFUND) {
            register(eventId, request.userId(), request.groupId(), request.slotAt());
        }
    }

    private void register(String event, UUID user, UUID group, Instant slot) {
        lock(group, slot, true);
        List<Map<String, Object>> existing = jdbc.queryForList(
                "SELECT user_id,group_id,slot_at FROM notification_result_bundle_members WHERE event_id=?", event);
        if (!existing.isEmpty()) {
            Map<String, Object> old = existing.get(0);
            if (!user.equals(old.get("user_id")) || !group.equals(old.get("group_id"))
                    || !slot.equals(((Timestamp) old.get("slot_at")).toInstant())) {
                throw new IllegalStateException("결과 사건의 묶음 축이 변경되었습니다: " + event);
            }
            return;
        }
        if (sealed(group, slot)) {
            throw new IllegalStateException("이미 완료된 결과 슬롯의 새 사건입니다: " + event);
        }
        jdbc.update("INSERT INTO notification_result_bundle_members(event_id,user_id,group_id,slot_at)"
                + " VALUES(?,?,?,?) ON CONFLICT DO NOTHING", event, user, group, Timestamp.from(slot));
    }

    /**
     * 기존 5분 flush가 호출한다. 직전 재훑기가 커밋된 뒤 실행하고, 과거 이관 원장도 함께 포함한다.
     * 마감·발행은 개별 트랜잭션이라 발행 직전 장애에도 저장된 manifest가 다음 실행의 재시도 근거다.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void flushClosedBundles() {
        if (!properties.isOutboxMode()) {
            return;
        }
        seedLegacyMembers();
        for (Map<String, Object> row : jdbc.queryForList("SELECT DISTINCT m.group_id,m.slot_at"
                + " FROM notification_result_bundle_members m LEFT JOIN notification_result_bundle_slots s"
                + " ON s.group_id=m.group_id AND s.slot_at=m.slot_at"
                + " WHERE s.group_id IS NULL AND m.slot_at+interval '15 minutes'<=clock_timestamp()"
                + " ORDER BY m.slot_at,m.group_id LIMIT 500")) {
            UUID group = (UUID) row.get("group_id");
            Instant slot = ((Timestamp) row.get("slot_at")).toInstant();
            transaction.executeWithoutResult(ignored -> seal(group, slot));
        }
        for (Map<String, Object> row : jdbc.queryForList("SELECT user_id,group_id,slot_at"
                + " FROM notification_result_bundle_manifests WHERE published_at IS NULL"
                + " ORDER BY slot_at,group_id,user_id LIMIT 500")) {
            transaction.executeWithoutResult(ignored -> publish((UUID) row.get("user_id"),
                    (UUID) row.get("group_id"), ((Timestamp) row.get("slot_at")).toInstant()));
        }
    }

    /** 구 경로는 OUTBOX 전환 전에 정지된다. 이관된 SENT/SUPPRESSED도 기대 사건의 수신 증거다. */
    private void seedLegacyMembers() {
        for (Map<String, Object> row : jdbc.queryForList("SELECT DISTINCT n.user_id,n.group_id,n.slot_at,"
                + "'noti:'||n.kind||':'||n.user_id||':'||n.subject_id||':none' AS event_id"
                + " FROM notification_sent_logs n WHERE n.kind IN ('BET_RESULT','BET_VOID_REFUND')"
                + " AND n.group_id IS NOT NULL AND n.slot_at IS NOT NULL AND n.subject_id IS NOT NULL"
                + " AND NOT EXISTS (SELECT 1 FROM notification_result_bundle_members m WHERE"
                + " m.event_id='noti:'||n.kind||':'||n.user_id||':'||n.subject_id||':none')"
                + " ORDER BY n.group_id,n.slot_at,n.user_id")) {
            transaction.executeWithoutResult(ignored -> register(row.get("event_id").toString(),
                    (UUID) row.get("user_id"), (UUID) row.get("group_id"),
                    ((Timestamp) row.get("slot_at")).toInstant()));
        }
    }

    /** USER 잠금이나 도메인 행 잠금은 여기서 얻지 않는다. 진행 중인 생산자의 커밋만 기다린다. */
    void seal(UUID group, Instant slot) {
        lock(group, slot, false);
        if (sealed(group, slot) || databaseNow().isBefore(slot.plusSeconds(SLOT_SECONDS))) {
            return;
        }
        jdbc.update("INSERT INTO notification_result_bundle_manifests(user_id,group_id,slot_at,event_ids)"
                + " SELECT user_id,group_id,slot_at,jsonb_agg(event_id ORDER BY event_id)"
                + " FROM notification_result_bundle_members WHERE group_id=? AND slot_at=?"
                + " GROUP BY user_id,group_id,slot_at", group, Timestamp.from(slot));
        jdbc.update("INSERT INTO notification_result_bundle_slots(group_id,slot_at,sealed_at)"
                + " VALUES(?,?,clock_timestamp())", group, Timestamp.from(slot));
    }

    private void publish(UUID user, UUID group, Instant slot) {
        List<String> rows = jdbc.queryForList("SELECT event_ids::text FROM notification_result_bundle_manifests"
                + " WHERE user_id=? AND group_id=? AND slot_at=? AND published_at IS NULL FOR UPDATE SKIP LOCKED",
                String.class, user, group, Timestamp.from(slot));
        if (rows.isEmpty()) {
            return;
        }
        // JSON 배열은 SQL에서 행으로 풀어 타입과 문자열의 escaping을 보존한다.
        List<String> events = jdbc.queryForList("SELECT jsonb_array_elements_text(?::jsonb)", String.class,
                rows.get(0));
        outbox.append(new OutboxAppendCommand("noti:resultBundle:" + user + ":" + group + ":" + slot.getEpochSecond(),
                1, EVENT_TYPE, user, null, group.toString(), AggregateRef.ofUser(user), null,
                Map.of("groupId", group.toString(), "slotAt", slot.toString(), "eventIds", events),
                List.of(OutboxDeliveryRequest.toKafka())));
        jdbc.update("UPDATE notification_result_bundle_manifests SET published_at=clock_timestamp()"
                + " WHERE user_id=? AND group_id=? AND slot_at=?", user, group, Timestamp.from(slot));
    }

    private boolean sealed(UUID group, Instant slot) {
        return !jdbc.queryForList("SELECT 1 FROM notification_result_bundle_slots WHERE group_id=? AND slot_at=?",
                group, Timestamp.from(slot)).isEmpty();
    }

    private void lock(UUID group, Instant slot, boolean shared) {
        String function = shared ? "pg_advisory_xact_lock_shared" : "pg_advisory_xact_lock";
        jdbc.queryForList("SELECT " + function + "(hashtextextended(?,0))",
                "notification-result-slot:" + group + ":" + slot.getEpochSecond());
    }

    private Instant databaseNow() {
        return jdbc.queryForObject("SELECT clock_timestamp()", Timestamp.class).toInstant();
    }

    static Instant slotOf(Instant time) {
        return Instant.ofEpochSecond(Math.floorDiv(time.getEpochSecond(), SLOT_SECONDS) * SLOT_SECONDS);
    }
}
