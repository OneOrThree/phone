package com.oneorthree.phone.outbox.support;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * 테스트가 쥐는 <b>생산 코드 밖</b>의 USER aggregate 잠금 — 정본 순서를 지키지 않는 다른 트랜잭션을 흉내 낸다.
 *
 * <p>애플리케이션 풀이 아니라 별도 JDBC 연결을 쓴다. 풀을 쓰면 잠금 감시(guard)를 지나거나 풀 상한을 먹어 관찰하려는
 * 경합 자체가 달라진다.
 *
 * <p>{@code deadlock_timeout} 을 길게 둔다 — 교착 순환이 생기면 PostgreSQL 은 먼저 기다리기 시작한 쪽의 검사에서
 * 순환을 발견해 <b>그쪽</b>을 끊는다. 이 연결이 스스로 먼저 끊기면 생산 경로의 롤백·재시도를 관찰할 수 없다.
 */
public final class RawUserLock implements AutoCloseable {

    private final Connection connection;
    private final int pid;

    private RawUserLock(Connection connection, int pid) {
        this.connection = connection;
        this.pid = pid;
    }

    /**
     * @return 트랜잭션을 연 새 연결
     * @throws SQLException 연결 실패
     */
    public static RawUserLock open() throws SQLException {
        Connection connection = DriverManager.getConnection(OutboxTestPostgres.INSTANCE.getJdbcUrl(),
                OutboxTestPostgres.INSTANCE.getUsername(), OutboxTestPostgres.INSTANCE.getPassword());
        connection.setAutoCommit(false);
        int pid;
        try (Statement statement = connection.createStatement()) {
            statement.execute("SET LOCAL deadlock_timeout = '60s'");
            try (ResultSet rows = statement.executeQuery("SELECT pg_backend_pid()")) {
                rows.next();
                pid = rows.getInt(1);
            }
        }
        return new RawUserLock(connection, pid);
    }

    /** @return 이 연결의 PostgreSQL 백엔드 pid — 누가 이 잠금에 막혔는지 가려내는 데 쓴다 */
    public int pid() {
        return pid;
    }

    /**
     * USER 행을 배타 잠금한다 — 이미 다른 트랜잭션이 쥐었으면 풀릴 때까지 기다린다.
     *
     * @param userId 잠글 사용자. 행이 미리 있어야 한다
     */
    public void lock(UUID userId) {
        try (PreparedStatement statement = connection.prepareStatement("SELECT aggregate_id FROM aggregate_versions"
                + " WHERE aggregate_type='USER' AND aggregate_id=? FOR UPDATE")) {
            statement.setString(1, userId.toString());
            try (ResultSet rows = statement.executeQuery()) {
                if (!rows.next()) {
                    throw new IllegalStateException("잠글 USER 행이 없다 — " + userId);
                }
            }
        } catch (SQLException failure) {
            throw new IllegalStateException(failure);
        }
    }

    /** 커밋해 잠금을 놓는다. */
    public void commit() {
        try {
            connection.commit();
        } catch (SQLException failure) {
            throw new IllegalStateException(failure);
        }
    }

    @Override
    public void close() throws SQLException {
        try {
            connection.rollback();
        } finally {
            connection.close();
        }
    }
}
