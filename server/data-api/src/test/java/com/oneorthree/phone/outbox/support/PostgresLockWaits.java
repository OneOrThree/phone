package com.oneorthree.phone.outbox.support;

import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.SQLException;
import java.util.Collection;
import java.util.UUID;

/**
 * 실제 PostgreSQL 에서 «누가 잠금을 기다리는가»를 본다 — 스레드 타이밍 추측 대신 서버 상태로 순서를 맞춘다.
 */
public final class PostgresLockWaits {

    private PostgresLockWaits() {
    }

    /**
     * 잠금을 기다리는 백엔드가 {@code count} 개 이상이 될 때까지 기다린다.
     *
     * @param jdbc  관찰용 연결
     * @param count 기다리는 백엔드 수
     */
    public static void awaitWaiting(JdbcTemplate jdbc, int count) {
        long deadline = System.nanoTime() + 20_000_000_000L;
        while (System.nanoTime() < deadline) {
            Integer waiting = jdbc.queryForObject("SELECT count(*) FROM pg_stat_activity"
                    + " WHERE datname = current_database() AND wait_event_type = 'Lock'"
                    + " AND pid <> pg_backend_pid()", Integer.class);
            if (waiting != null && waiting >= count) {
                return;
            }
            try {
                Thread.sleep(5);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(interrupted);
            }
        }
        throw new IllegalStateException("잠금 대기가 " + count + "개에 이르지 않았다");
    }

    /**
     * {@code holder} 가 쥔 잠금에 막힌 백엔드가 생길 때까지 기다린다.
     *
     * <p>DB 전체의 대기 수를 세면 앞 테스트에서 끝나지 않은 스레드의 대기가 섞여 조건이 거짓으로 참이 되고, 판정·쓰기가
     * 무거운 배치가 느린 러너에서 짧은 시한을 넘기면 반대로 거짓으로 실패한다. 그래서 «이 테스트의 연결이 막고 있는
     * 백엔드»만 세고, 시한은 조건이 서면 곧바로 돌아오므로 넉넉히 둔다.
     *
     * @param jdbc   관찰용 연결
     * @param holder 잠금을 쥔 테스트 연결
     */
    public static void awaitBlockedBy(JdbcTemplate jdbc, RawUserLock holder) {
        long deadline = System.nanoTime() + 300_000_000_000L;
        while (System.nanoTime() < deadline) {
            Integer blocked = jdbc.queryForObject("SELECT count(*) FROM pg_stat_activity"
                    + " WHERE ? = ANY(pg_blocking_pids(pid))", Integer.class, holder.pid());
            if (blocked != null && blocked > 0) {
                return;
            }
            try {
                Thread.sleep(20);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(interrupted);
            }
        }
        throw new IllegalStateException("테스트 연결(pid " + holder.pid() + ")이 쥔 잠금에 막힌 백엔드가 없다");
    }

    /**
     * USER aggregate 행을 미리 만든다 — 잠금 대상 행이 없으면 {@code FOR UPDATE} 가 기다리지 않는다.
     *
     * @param jdbc    자동 커밋 연결
     * @param userIds 사용자
     */
    public static void ensureUserRows(JdbcTemplate jdbc, Collection<UUID> userIds) {
        for (UUID userId : userIds) {
            jdbc.update("INSERT INTO aggregate_versions(aggregate_type,aggregate_id,last_version,updated_at)"
                    + " VALUES('USER',?,0,now()) ON CONFLICT DO NOTHING", userId.toString());
        }
    }

    /**
     * @param failure 실패
     * @return 원인 사슬에서 찾은 SQLSTATE. 없으면 {@code null}
     */
    public static String sqlStateOf(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && sql.getSQLState() != null) {
                return sql.getSQLState();
            }
        }
        return null;
    }
}
