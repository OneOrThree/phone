package com.oneorthree.phone.auth.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V101 계정 전환 열 추가의 실 SQL 검증 (GROMO-1992).
 *
 * <p>보는 것 네 가지: ① V100 까지 올린 스키마의 기존 PENDING/COMPLETED/INVALIDATED 행 위에
 * V101 이 적용되고 기존 행이 {@code false + 7 null} 로 남는다, ② 정확한 8열의
 * 타입/default/nullability, ③ {@code ck_login_attempts_switch_state} 제약 존재, ④ 빈 DB 의
 * 전체 마이그레이션 경로에서도 V101 이 적용된다. 검증 방식은 {@code GroupMemberV30MigrationTest}
 * 선례 — 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 */
class LoginAttemptV101MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID PENDING_ID = UUID.randomUUID();
    private static final UUID COMPLETED_ID = UUID.randomUUID();
    private static final UUID INVALIDATED_ID = UUID.randomUUID();

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V100 의 기존 행 위에 V101 이 적용되고, 기존 행은 confirmed=false + 전환 7열 null 로 남는다")
    void v101BackfillsLegacyRowsAsUnconfirmed() {
        migrate(MigrationVersion.fromVersion("100"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertAttempt(jdbcTemplate, PENDING_ID, "PENDING");
        insertAttempt(jdbcTemplate, COMPLETED_ID, "COMPLETED");
        insertAttempt(jdbcTemplate, INVALIDATED_ID, "INVALIDATED");

        migrate(MigrationVersion.LATEST);

        for (UUID id : List.of(PENDING_ID, COMPLETED_ID, INVALIDATED_ID)) {
            Map<String, Object> row = jdbcTemplate.queryForMap(
                    "SELECT account_switch_confirmed, switch_phase, switch_source_user_id,"
                            + " switch_source_session_id, switch_source_auth_generation,"
                            + " switch_target_user_id, switch_target_social_account_id,"
                            + " switch_verified_at FROM login_attempts WHERE attempt_id = ?", id);
            assertThat(row)
                    .containsEntry("account_switch_confirmed", false)
                    .containsEntry("switch_phase", null)
                    .containsEntry("switch_source_user_id", null)
                    .containsEntry("switch_source_session_id", null)
                    .containsEntry("switch_source_auth_generation", null)
                    .containsEntry("switch_target_user_id", null)
                    .containsEntry("switch_target_social_account_id", null)
                    .containsEntry("switch_verified_at", null);
        }
    }

    @Test
    @DisplayName("8열의 타입·nullability·default 와 ck_login_attempts_switch_state 제약이 정확히 생긴다")
    void v101CreatesExactColumnsAndCheck() {
        migrate(MigrationVersion.LATEST);
        JdbcTemplate jdbcTemplate = jdbcTemplate();

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT column_name, data_type, is_nullable, column_default"
                        + " FROM information_schema.columns"
                        + " WHERE table_name = 'login_attempts' AND column_name LIKE '%switch%'");
        assertThat(rows).hasSize(8);
        Map<String, Map<String, Object>> columns = rows.stream().collect(Collectors.toMap(
                row -> (String) row.get("column_name"), row -> row));

        assertColumn(columns.get("account_switch_confirmed"), "boolean", "NO", "false");
        assertColumn(columns.get("switch_phase"), "character varying", "YES", null);
        assertColumn(columns.get("switch_source_user_id"), "uuid", "YES", null);
        assertColumn(columns.get("switch_source_session_id"), "uuid", "YES", null);
        assertColumn(columns.get("switch_source_auth_generation"), "bigint", "YES", null);
        assertColumn(columns.get("switch_target_user_id"), "uuid", "YES", null);
        assertColumn(columns.get("switch_target_social_account_id"), "uuid", "YES", null);
        assertColumn(columns.get("switch_verified_at"), "timestamp with time zone", "YES", null);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT character_maximum_length FROM information_schema.columns"
                        + " WHERE table_name = 'login_attempts' AND column_name = 'switch_phase'",
                Integer.class)).isEqualTo(24);

        Integer checkCount = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM pg_constraint WHERE conname = 'ck_login_attempts_switch_state'",
                Integer.class);
        assertThat(checkCount).isEqualTo(1);
    }

    @Test
    @DisplayName("빈 DB 의 전체 마이그레이션 경로에서도 V101 이 성공으로 기록된다")
    void v101AppliesOnEmptyDatabase() {
        migrate(MigrationVersion.LATEST);

        String state = jdbcTemplate().queryForObject(
                "SELECT success::text FROM flyway_schema_history WHERE version = '101'",
                String.class);
        assertThat(state).isEqualTo("true");
    }

    private void assertColumn(Map<String, Object> column, String type, String nullable,
            String defaultValue) {
        assertThat(column).isNotNull();
        assertThat(column.get("data_type")).isEqualTo(type);
        assertThat(column.get("is_nullable")).isEqualTo(nullable);
        if (defaultValue == null) {
            assertThat(column.get("column_default")).isNull();
        } else {
            assertThat((String) column.get("column_default")).contains(defaultValue);
        }
    }

    private void insertAttempt(JdbcTemplate jdbcTemplate, UUID attemptId, String status) {
        jdbcTemplate.update(
                "INSERT INTO login_attempts (attempt_id, status, digest_key_id, credential_digest,"
                        + " provider, credential_kind, terms_version, claimed_at, recovery_expires_at)"
                        + " VALUES (?, ?, 'key-id', 'digest', 'APPLE', 'id_token', '2026-09',"
                        + " now(), now() + interval '5 minutes')",
                attemptId, status);
    }

    private void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private JdbcTemplate jdbcTemplate() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}
