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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** V46(repeat_days smallint → integer)의 실 PostgreSQL 마이그레이션 검증. */
class GroupChallengeV46MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID CHALLENGE_ID = UUID.randomUUID();

    private JdbcTemplate jdbc;

    @BeforeEach
    void resetSchema() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("repeat_days를 integer로 확장하고 기존 값과 범위 CHECK를 보존한다")
    void widensRepeatDaysToIntegerWithoutDataOrConstraintLoss() {
        migrate("34");
        insertChallenge();

        assertThat(repeatDaysType()).isEqualTo("int2");

        migrate("46");

        assertThat(repeatDaysType()).isEqualTo("int4");
        assertThat(jdbc.queryForObject(
                "SELECT repeat_days FROM group_challenges WHERE id = ?", Integer.class, CHALLENGE_ID))
                .isEqualTo(127);
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE group_challenges SET repeat_days = 0 WHERE id = ?", CHALLENGE_ID))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("group_challenges_repeat_days_check");
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE group_challenges SET repeat_days = 128 WHERE id = ?", CHALLENGE_ID))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("group_challenges_repeat_days_check");
    }

    private void insertChallenge() {
        jdbc.update(
                "INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status)"
                        + " VALUES (?, false, 'OWNER_ONLY', 10, '타입변환검증방', 'ACTIVE')",
                GROUP_ID);
        jdbc.update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at,"
                        + " repeat_days, started_at)"
                        + " VALUES (?, ?, 'DURATION', 'FOCUS', 'ACTIVE', now(), 127, now())",
                CHALLENGE_ID, GROUP_ID);
    }

    private String repeatDaysType() {
        return jdbc.queryForObject(
                "SELECT udt_name FROM information_schema.columns"
                        + " WHERE table_schema = 'public' AND table_name = 'group_challenges'"
                        + " AND column_name = 'repeat_days'",
                String.class);
    }

    private void migrate(String target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(target))
                .load()
                .migrate();
    }
}
