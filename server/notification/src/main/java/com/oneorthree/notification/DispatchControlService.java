package com.oneorthree.notification;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** 현재 알림 발송 게이트와 예약 작업 재실행을 관리한다. */
@Service
class DispatchControlService {
    private static final int MAX_REPLAY = 200;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final long DRAIN_POLL_MILLIS = 100;

    private final Store store;
    private final AdminAudit audit;
    private final Clock clock;
    private final int drainBudgetSeconds;

    DispatchControlService(Store store, AdminAudit audit, Clock clock,
            @Value("${notification.drain-budget-seconds:30}") int drainBudgetSeconds) {
        this.store = store;
        this.audit = audit;
        this.clock = clock;
        this.drainBudgetSeconds = drainBudgetSeconds;
    }

    @Transactional
    public Map<String, Object> state(String actor) {
        audit.record(actor, "dispatch.state", null, Map.of());
        return Map.of("dispatch", gate());
    }

    private Map<String, Object> gate() {
        Map<String, Object> row = store.one("SELECT enabled,ever_opened,updated_at FROM dispatch_control WHERE id=1");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", row != null && Boolean.TRUE.equals(row.get("enabled")));
        result.put("everOpened", row != null && Boolean.TRUE.equals(row.get("ever_opened")));
        result.put("updatedAt", row == null ? null : AdminCatalog.instant(row.get("updated_at")));
        return result;
    }

    /** 종료 후 과거 개방 키를 재생해도 다시 열지 않는다. 새 개방에는 새 멱등 키가 필요하다. */
    @Transactional
    public Map<String, Object> open(String actor, String key) {
        audit.record(actor, "dispatch.open", null, Map.of());
        return store.command("dispatch-open", key, Map.of("action", "open"), () -> {
            store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true,updated_at=now() WHERE id=1");
            audit.record(actor, "dispatch.opened", null, Map.of());
            return Map.of("dispatch", gate());
        }, false, () -> {
            Map<String, Object> control = store.one("SELECT enabled FROM dispatch_control WHERE id=1 FOR UPDATE");
            if (control == null || !Boolean.TRUE.equals(control.get("enabled"))) {
                throw new NotificationFailure(409, "DISPATCH_CLOSED");
            }
        });
    }

    /** 게이트를 닫은 뒤 이미 시작한 발송 임대가 해제될 때까지 제한 시간 안에서 기다린다. */
    @Transactional(timeout = 120)
    public Map<String, Object> close(String actor, String key) {
        audit.record(actor, "dispatch.close", null, Map.of());
        return store.command("dispatch-close", key, Map.of("action", "close"), () -> {
            store.update("UPDATE dispatch_control SET enabled=false,updated_at=now() WHERE id=1");
            audit.record(actor, "dispatch.closed", null, Map.of());
            boolean drained = drain(actor);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("dispatch", gate());
            result.put("drained", drained);
            return result;
        }, true);
    }

    /** 게이트 종료에 드레인 및 시간 초과 관측을 적용한다. */
    private boolean drain(String actor) {
        boolean drained = awaitInFlightSends();
        if (!drained) {
            audit.record(actor, "dispatch.drain.timeout", null, Map.of());
        }
        return drained;
    }

    /**
     * 진행 중인 외부 발송이 모두 끝나기를 기다린다.
     *
     * <p>임대는 {@code DispatchService} 가 판정 커밋과 함께 걸고 결과를 맺을 때 푼다. 그래서 살아
     * 있는 임대가 하나라도 있으면 <b>지금 FCM 을 부르는 중인 워커가 있다</b>는 뜻이다.
     *
     * <p>무한히 기다리지 않는다. 발송 도중 프로세스가 죽으면 그 임대는 만료까지 남으므로, 기다림에
     * 상한이 없으면 게이트 닫기가 관리자 API 를 통째로 붙잡는다. 예산을 넘기면 {@code false} 를
     * 돌려주고 판단은 운영자에게 넘긴다.
     *
     * @return 예산 안에 모두 끝났는가
     */
    private boolean awaitInFlightSends() {
        // 예산은 «실제로 흐른 시간»이라 도메인 시계(clock)가 아니라 nanoTime 으로 잰다. clock 은
        // 테스트에서 고정되므로 그것으로 재면 예산이 영영 끝나지 않아 여기서 멈춘다. 임대 생존
        // 판정도 같은 이유로 DB 의 now() 를 쓴다 — 둘 다 실시간 축이라야 서로 맞는다.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(drainBudgetSeconds);
        while (true) {
            if (store.one("SELECT id FROM deliveries WHERE lease_expires_at>now() LIMIT 1") == null) {
                return true;
            }
            if (System.nanoTime() - deadline >= 0) {
                return false;
            }
            try {
                Thread.sleep(DRAIN_POLL_MILLIS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
    }

    // ── 놓친 잡 재생 ────────────────────────────────────────────────────

    /**
     * 실행되지 않은 예약 작업을 등록부에 내구화한다.
     * 실행 자체는 알림 등록부(잡 소유자)가 한다 — 여기서 completed_at 을 찍지 않는다.
     */
    @Transactional
    public Map<String, Object> replay(String actor, String jobId, Map<String, Object> body, String key) {
        audit.record(actor, "jobs.replay", jobId, Map.of());
        return store.command("job-replay:" + jobId, key, Map.of("body", body), () -> {
            Map<String, Object> job = store.one("SELECT id,owner,cron FROM jobs WHERE id=? FOR UPDATE", jobId);
            if (job == null) {
                // 없는 잡을 성공으로 접으면 「재생했다」는 거짓 증거가 남는다.
                throw new NotificationFailure(404, "UNKNOWN_JOB");
            }
            if (!"NOTIFICATION".equals(job.get("owner"))) {
                throw new NotificationFailure(409, "JOB_OWNED_BY_DATA");
            }
            Instant to = body.get("to") == null ? clock.instant()
                    : Instant.ofEpochMilli(Json.number(body, "to"));
            Instant from = from(jobId, body);
            if (!from.isBefore(to)) {
                throw new NotificationFailure(400, "INVALID_REPLAY_WINDOW");
            }
            CronExpression cron;
            try {
                cron = CronExpression.parse(job.get("cron").toString());
            } catch (IllegalArgumentException invalid) {
                throw new NotificationFailure(400, "INVALID_CRON");
            }
            List<String> scheduled = new ArrayList<>();
            long queued = 0;
            ZonedDateTime cursor = from.atZone(KST);
            ZonedDateTime end = to.atZone(KST);
            while (true) {
                ZonedDateTime next = cron.next(cursor);
                if (next == null || next.isAfter(end)) {
                    break;
                }
                if (scheduled.size() >= MAX_REPLAY) {
                    throw new NotificationFailure(400, "REPLAY_WINDOW_TOO_LARGE");
                }
                scheduled.add(next.toInstant().toString());
                queued += store.update("INSERT INTO job_runs(job_id,scheduled_at) VALUES(?,?)"
                        + " ON CONFLICT DO NOTHING", jobId, Timestamp.from(next.toInstant()));
                cursor = next;
            }
            audit.record(actor, "jobs.replay.queued", jobId, Map.of("missed", scheduled.size(), "queued", queued));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("jobId", jobId);
            result.put("from", from.toString());
            result.put("to", to.toString());
            result.put("missed", (long) scheduled.size());
            result.put("queued", queued);
            result.put("scheduledAt", scheduled);
            // 실행은 등록부가 한다. 여기서 「성공」으로 표시하지 않는다.
            result.put("executed", false);
            return result;
        });
    }

    private Instant from(String jobId, Map<String, Object> body) {
        if (body.get("from") != null) {
            return Instant.ofEpochMilli(Json.number(body, "from"));
        }
        Map<String, Object> last = store.one("SELECT max(scheduled_at) AS last FROM job_runs"
                + " WHERE job_id=? AND completed_at IS NOT NULL", jobId);
        if (last == null || last.get("last") == null) {
            throw new NotificationFailure(400, "REPLAY_WINDOW_REQUIRED");
        }
        return ((Timestamp) last.get("last")).toInstant();
    }
}
