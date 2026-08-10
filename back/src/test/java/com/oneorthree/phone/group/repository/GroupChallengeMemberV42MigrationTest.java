package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V42(창 사용분 보고 measured_at, GROMO-1407·N34)의 실 SQL 검증.
 *
 * <p>보는 것: ① V41 까지는 {@code group_challenge_members.measured_at} 이 없다 — V42 이후 생긴다,
 * ② 컬럼은 nullable 이라 기존 행(레거시 보고)은 null 그대로 살아남는다 — "시각 모름" 행에는 어떤
 * 보고든 갱신을 허용하는 비교 규칙의 전제다, ③ timestamptz 값이 저장·조회된다.
 */
class GroupChallengeMemberV42MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final LocalDate DATE = LocalDate.of(2026, 8, 10);

    private JdbcTemplate jdbc;
    private UUID challengeId;
    private UUID userId;

    @BeforeEach
    void resetSchema() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V41 까지는 measured_at 컬럼이 없다 — V42 가 nullable 로 추가하고 기존 행은 null 로 남는다")
    void measuredAtColumnAppearsAtV42AndLegacyRowsStayNull() {
        seedAt("41");
        assertThat(hasColumn()).isFalse();
        UUID legacyRow = insertReport(DATE);

        migrate("42");

        assertThat(hasColumn()).isTrue();
        // 컬럼은 nullable — 마이그레이션이 기존 보고 행을 깨뜨리지 않는다.
        assertThat(jdbc.queryForObject(
                "SELECT is_nullable FROM information_schema.columns"
                        + " WHERE table_schema = 'public' AND table_name = 'group_challenge_members'"
                        + " AND column_name = 'measured_at'", String.class))
                .isEqualTo("YES");
        assertThat(jdbc.queryForObject(
                "SELECT measured_at FROM group_challenge_members WHERE id = ?",
                java.sql.Timestamp.class, legacyRow)).isNull();

        // timestamptz 값이 저장·조회된다.
        UUID newRow = insertReport(DATE.plusDays(1));
        jdbc.update("UPDATE group_challenge_members SET measured_at = '2026-08-10T14:03:00Z' WHERE id = ?",
                newRow);
        assertThat(jdbc.queryForObject(
                "SELECT measured_at FROM group_challenge_members WHERE id = ?",
                java.time.OffsetDateTime.class, newRow).toInstant())
                .isEqualTo(java.time.Instant.parse("2026-08-10T14:03:00Z"));
    }

    // ── 시드 ────────────────────────────────────────────────────────────

    private void seedAt(String target) {
        migrate(target);
        userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, created_at, is_guest, nickname, is_deleted)"
                + " VALUES (?, now(), false, '재영', false)", userId);
        UUID groupId = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name,"
                + " status) VALUES (?, false, 'OWNER_ONLY', 10, '스터디', 'ACTIVE')", groupId);
        challengeId = UUID.randomUUID();
        StringBuilder columns = new StringBuilder("id, group_id, category, type, status, created_at");
        StringBuilder values = new StringBuilder("?, ?, 'SCREEN_TIME', 'TIME_WINDOW', 'ACTIVE', now()");
        if (hasColumn("group_challenges", "repeat_days")) {
            columns.append(", repeat_days");
            values.append(", 127");
        }
        if (hasColumn("group_challenges", "started_at")) {
            columns.append(", started_at");
            values.append(", now()");
        }
        jdbc.update("INSERT INTO group_challenges (" + columns + ") VALUES (" + values + ")",
                challengeId, groupId);
    }

    private UUID insertReport(LocalDate date) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO group_challenge_members (id, group_challenge_id, user_id, usage_date,"
                + " progress_minutes, is_achieved, created_at, updated_at)"
                + " VALUES (?, ?, ?, ?, 30, false, now(), now())",
                id, challengeId, userId, date);
        return id;
    }

    private boolean hasColumn() {
        return hasColumn("group_challenge_members", "measured_at");
    }

    private boolean hasColumn(String table, String column) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.columns"
                        + " WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
                Integer.class, table, column);
        return count != null && count > 0;
    }

    private void migrate(String target) {
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(resolveTarget(target))
                .load();
        flyway.migrate();
    }

    /**
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다 — 선행 배치(B1·B2)의 V34~V38 이
     * 아직 없는 워크트리에서도 동작한다(Flyway 는 존재하지 않는 target 을 오류로 본다).
     * {@code GroupBetV41MigrationTest} 와 같은 장치다.
     */
    private MigrationVersion resolveTarget(String requested) {
        MigrationVersion wanted = MigrationVersion.fromVersion(requested);
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load();
        MigrationVersion best = null;
        for (org.flywaydb.core.api.MigrationInfo info : flyway.info().all()) {
            MigrationVersion version = info.getVersion();
            if (version == null || version.compareTo(wanted) > 0) {
                continue;
            }
            if (best == null || version.compareTo(best) > 0) {
                best = version;
            }
        }
        if (best == null) {
            throw new IllegalStateException("적용 가능한 마이그레이션이 없습니다 — target=" + requested);
        }
        return best;
    }
}
