package com.oneorthree.notification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 등록부의 실제 실행기. Data 소유 잡은 이 프로세스에서 실행할 수 없다. */
@Service
class JobRegistry {
    private static final Logger LOG = LoggerFactory.getLogger(JobRegistry.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private final Store store;
    private final DispatchService dispatch;
    private final AckService ack;
    private final SnapshotReconciler snapshots;
    private final Clock clock;

    JobRegistry(Store store, DispatchService dispatch, AckService ack, SnapshotReconciler snapshots, Clock clock) {
        this.store = store;
        this.dispatch = dispatch;
        this.ack = ack;
        this.snapshots = snapshots;
        this.clock = clock;
    }

    void tick() {
        for (Map<String, Object> job : store.rows("SELECT * FROM jobs WHERE owner='NOTIFICATION' AND enabled"
                + " ORDER BY id")) {
            String id = job.get("id").toString();
            try {
                if ("bundle-flush".equals(id) && !dispatchOpen()) {
                    continue;
                }
                schedule(job);
                // 이관 replay 가 적재한 실행도 같은 경로로 소비한다. 성공하기 전에는 완료로 기록하지 않는다.
                List<Map<String, Object>> due = store.rows("SELECT scheduled_at FROM job_runs WHERE job_id=?"
                        + " AND completed_at IS NULL AND scheduled_at<=? ORDER BY scheduled_at LIMIT 1",
                        id, Timestamp.from(clock.instant()));
                for (Map<String, Object> run : due) {
                    Timestamp at = (Timestamp) run.get("scheduled_at");
                    try {
                        // 개별 후보의 실패는 여기까지 올라오지 않는다 — 마지막 사유만 회차에 남긴다.
                        String outcome = execute(id);
                        store.update("UPDATE job_runs SET completed_at=?,lease_expires_at=NULL,error=?"
                                + " WHERE job_id=? AND scheduled_at=?", Timestamp.from(clock.instant()), outcome,
                                id, at);
                    } catch (RuntimeException failure) {
                        store.update("UPDATE job_runs SET error=? WHERE job_id=? AND scheduled_at=?",
                                failure.getClass().getSimpleName(), id, at);
                        throw failure;
                    }
                }
            } catch (RuntimeException failure) {
                LOG.warn("알림 잡 재시도 대기: job={}, 원인={}", id, failure.getClass().getSimpleName());
            }
        }
    }

    private boolean dispatchOpen() {
        Map<String, Object> gate = store.one("SELECT enabled FROM dispatch_control WHERE id=1");
        return gate != null && Boolean.TRUE.equals(gate.get("enabled"));
    }

    private void schedule(Map<String, Object> job) {
        String id = job.get("id").toString();
        Map<String, Object> last = store.one("SELECT max(scheduled_at) AS at FROM job_runs WHERE job_id=?", id);
        Instant changed = ((Timestamp) job.get("updated_at")).toInstant();
        Instant cursor = last.get("at") == null ? changed.minusNanos(1) : ((Timestamp) last.get("at")).toInstant();
        if (cursor.isBefore(changed)) {
            // 활성화/cron 수정 전 정지 창은 명시적인 replay 로 넣는다.
            cursor = changed.minusNanos(1);
        }
        CronExpression cron = CronExpression.parse(job.get("cron").toString());
        ZonedDateTime next = cron.next(cursor.atZone(KST));
        for (int count = 0; count < 200 && next != null && !next.toInstant().isAfter(clock.instant()); count++) {
            store.update("INSERT INTO job_runs(job_id,scheduled_at) VALUES(?,?) ON CONFLICT DO NOTHING",
                    id, Timestamp.from(next.toInstant()));
            next = cron.next(next);
        }
    }

    /** @return 회차에 남길 마지막 실패 사유 — 전부 정상이면 null */
    private String execute(String job) {
        switch (job) {
            case "bundle-flush" -> {
                return flush();
            }
            case "ack-reconcile" -> ack.reconcile();
            case "user-reconcile" -> snapshots.reconcile();
            default -> throw new NotificationFailure(422, "UNSUPPORTED_JOB");
        }
        return null;
    }

    /**
     * 후보를 한 건씩 «격리»해 처리한다.
     *
     * <p>한 건의 실패로 통째로 빠져나가면 그 행은 다음 tick 에서도 같은 정렬(next_attempt_at,id)로
     * 맨 앞에 다시 서고, 뒤에 놓인 «다른 종류·다른 사용자»의 정상 알림이 하나도 나가지 못한다.
     * 콘솔에서 특정 kind 의 템플릿을 끄는 것만으로 전체 발송 큐가 무기한 멈추는 경로가 그것이다.
     * 실패는 별도 트랜잭션으로 재시도 시각을 밀어 내구화하고, 나머지 후보는 계속 처리한다.
     */
    private String flush() {
        String outcome = null;
        for (UUID id : dispatch.candidates()) {
            try {
                dispatch.dispatch(id);
            } catch (RuntimeException failure) {
                outcome = reason(failure);
                LOG.warn("발송 후보 격리: delivery={}, 원인={}", id, outcome);
                dispatch.backOff(id, outcome);
            }
        }
        return outcome;
    }

    private static String reason(RuntimeException failure) {
        return failure instanceof NotificationFailure coded && coded.getMessage() != null
                ? coded.getMessage() : failure.getClass().getSimpleName();
    }
}
