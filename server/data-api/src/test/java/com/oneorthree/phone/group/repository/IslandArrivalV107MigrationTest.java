package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V107 섬 도착 기록 + 시스템 편지의 실 SQL 검증 (GROMO-2260). {@code LoginAttemptV101MigrationTest} 선례 —
 * 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 */
class IslandArrivalV107MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
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
    @DisplayName("V106 의 친구 편지는 kind=FRIEND·island_id NULL 로 남고, 활성 소속만 도착 기록으로 백필된다")
    void v107KeepsFriendLettersAndBackfillsActiveMemberships() {
        migrate(MigrationVersion.fromVersion("106"));
        JdbcTemplate jdbc = jdbc();
        UUID sender = user(jdbc, "보낸이");
        UUID receiver = user(jdbc, "받는이");
        UUID letter = UUID.randomUUID();
        jdbc.update("INSERT INTO letters (id, sender_id, receiver_id, content, created_at)"
                + " VALUES (?, ?, ?, '안녕', now())", letter, sender, receiver);
        UUID island = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status)"
                + " VALUES (?, false, 'OWNER_ONLY', 10, '섬', 'ACTIVE')", island);
        membership(jdbc, sender, island, false);
        membership(jdbc, receiver, island, true);

        migrate(MigrationVersion.LATEST);

        Map<String, Object> row = jdbc.queryForMap(
                "SELECT sender_id, kind, island_id FROM letters WHERE id = ?", letter);
        assertThat(row).containsEntry("sender_id", sender).containsEntry("kind", "FRIEND")
                .containsEntry("island_id", null);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_arrivals WHERE user_id = ? AND island_id = ?",
                Long.class, sender, island)).as("활성 소속은 가 본 섬").isEqualTo(1L);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_arrivals WHERE user_id = ?",
                Long.class, receiver)).as("떠난 소속은 백필하지 않는다").isZero();
    }

    @Test
    @DisplayName("시스템 편지는 발신자 없이 들어가고, kind 는 세 값만 받는다")
    void v107AllowsSystemLettersAndChecksKind() {
        migrate(MigrationVersion.LATEST);
        JdbcTemplate jdbc = jdbc();
        UUID receiver = user(jdbc, "받는이");

        jdbc.update("INSERT INTO letters (id, sender_id, receiver_id, content, kind, created_at)"
                + " VALUES (?, NULL, ?, '안내', 'KICK', now())", UUID.randomUUID(), receiver);
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO letters (id, sender_id, receiver_id, content, kind, created_at)"
                        + " VALUES (?, NULL, ?, '안내', 'SPAM', now())", UUID.randomUUID(), receiver))
                .isInstanceOf(DataIntegrityViolationException.class);

        Map<String, Object> kind = jdbc.queryForMap("SELECT is_nullable, column_default, character_maximum_length"
                + " FROM information_schema.columns WHERE table_name = 'letters' AND column_name = 'kind'");
        assertThat(kind).containsEntry("is_nullable", "NO").containsEntry("character_maximum_length", 20);
        assertThat((String) kind.get("column_default")).contains("FRIEND");
        assertThat(jdbc.queryForObject("SELECT is_nullable FROM information_schema.columns"
                + " WHERE table_name = 'letters' AND column_name = 'sender_id'", String.class)).isEqualTo("YES");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM information_schema.columns"
                + " WHERE table_name = 'island_arrivals'", Long.class)).isEqualTo(4L);
        assertThat(jdbc.queryForObject("SELECT success::text FROM flyway_schema_history WHERE version = '107'",
                String.class)).isEqualTo("true");
    }

    private static UUID user(JdbcTemplate jdbc, String nickname) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, created_at, is_guest, nickname, is_deleted)"
                + " VALUES (?, now(), false, ?, false)", id, nickname);
        return id;
    }

    private static void membership(JdbcTemplate jdbc, UUID userId, UUID groupId, boolean left) {
        jdbc.update("INSERT INTO group_members (id, user_id, group_id, role, notification_enabled,"
                + " is_left, left_reason, created_at, updated_at) VALUES (?, ?, ?, 'MEMBER', true, ?, ?, now(), now())",
                UUID.randomUUID(), userId, groupId, left, left ? "LEFT" : null);
    }

    private void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}
