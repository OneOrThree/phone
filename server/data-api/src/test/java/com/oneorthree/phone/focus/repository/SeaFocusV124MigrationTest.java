package com.oneorthree.phone.focus.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V124 바다 집중 세션 컬럼 + 한마디 테이블의 실 SQL 검증 (GROMO-2299). 검증 방식은 {@code IslandGuestbookV113MigrationTest}
 * 선례 — 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 *
 * <p>보는 것: ① V117 까지 올린 스키마의 기존 세션이 {@code kind='ISLAND'} 로 채워지고 새 컬럼은 null 이다,
 * ② {@code membership_epoch_at_start} NOT NULL 이 풀렸다, ③ {@code sea_remarks} 의 열·PK·FK 연쇄 삭제.
 */
class SeaFocusV124MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다. */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbc = jdbc();
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V117 시점의 기존 세션 상세는 kind=ISLAND 로 채워지고 sailing_minutes·arrived 는 null 이며, epoch 의 NOT NULL 이 풀린다")
    void existingSessionsBecomeIslandSessions() {
        migrate(MigrationVersion.fromVersion("117"));
        JdbcTemplate jdbc = jdbc();
        UUID userId = UUID.randomUUID();
        UUID islandId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, is_guest) VALUES (?, true)", userId);
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '옛섬', 10, true, 'OWNER_ONLY', 'WAITING')", islandId);
        jdbc.update("INSERT INTO focus_sessions (id, user_id, started_at, total_distraction_seconds, status) "
                + "VALUES (?, ?, now(), 0, 'ACTIVE')", sessionId, userId);
        jdbc.update("INSERT INTO focus_session_details (session_id, user_id, island_id, membership_epoch_at_start, "
                + "subject, lifecycle, last_transition_at) VALUES (?, ?, ?, 1, '공부', 'ACTIVE', now())",
                sessionId, userId, islandId);

        migrate(MigrationVersion.LATEST);

        Map<String, Object> row = jdbc.queryForMap(
                "SELECT kind, sailing_minutes, arrived FROM focus_session_details WHERE session_id = ?", sessionId);
        assertThat(row).containsEntry("kind", "ISLAND").containsEntry("sailing_minutes", null)
                .containsEntry("arrived", null);
        assertThat(column("focus_session_details", "kind")).containsEntry("is_nullable", "NO")
                .containsEntry("character_maximum_length", 10);
        assertThat(column("focus_session_details", "membership_epoch_at_start")).containsEntry("is_nullable", "YES");
        assertThat(column("focus_session_details", "sailing_minutes")).containsEntry("is_nullable", "YES");
        assertThat(column("focus_session_details", "arrived")).containsEntry("is_nullable", "YES")
                .containsEntry("data_type", "boolean");
    }

    @Test
    @DisplayName("sea_remarks 의 열·PK 와 users FK 연쇄 삭제가 정확히 생긴다")
    void remarksTableShape() {
        migrate(MigrationVersion.LATEST);
        JdbcTemplate jdbc = jdbc();

        assertThat(column("sea_remarks", "user_id")).containsEntry("data_type", "uuid")
                .containsEntry("is_nullable", "NO");
        assertThat(column("sea_remarks", "remark")).containsEntry("character_maximum_length", 20)
                .containsEntry("is_nullable", "NO");
        assertThat(column("sea_remarks", "changed_at")).containsEntry("data_type", "timestamp with time zone")
                .containsEntry("is_nullable", "NO");
        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.key_column_usage "
                + "WHERE table_name = 'sea_remarks' AND constraint_name = 'sea_remarks_pkey'", String.class))
                .containsExactly("user_id");

        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, is_guest) VALUES (?, false)", userId);
        jdbc.update("INSERT INTO sea_remarks (user_id, remark, changed_at) VALUES (?, '안녕', now())", userId);
        jdbc.update("DELETE FROM users WHERE id = ?", userId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sea_remarks", Integer.class)).isZero();
    }

    private Map<String, Object> column(String table, String column) {
        return jdbc().queryForMap("SELECT data_type, is_nullable, character_maximum_length "
                + "FROM information_schema.columns WHERE table_name = ? AND column_name = ?", table, column);
    }

    private void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private static JdbcTemplate jdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                POSTGRES.getPassword()));
    }
}
