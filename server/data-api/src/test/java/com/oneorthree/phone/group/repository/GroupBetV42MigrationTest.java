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
 * V42(참가 행 achieved_at, GROMO-1268 · LLD §1.1)의 실 SQL 검증.
 *
 * <p>보는 것: ① V42 이전에는 컬럼이 없다, ② V42 이후 nullable 로 추가되어 기존 행·조기 확정
 * 없는 행은 null 로 남고, 조기 확정 시각을 저장·조회할 수 있다.
 */
class GroupBetV42MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final LocalDate TODAY = LocalDate.of(2026, 8, 10);

    private JdbcTemplate jdbc;
    private UUID groupId;
    private UUID challengeId;
    private UUID configId;
    private UUID sessionId;
    private UUID userId;

    @BeforeEach
    void resetSchema() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V41 까지는 achieved_at 컬럼이 없고, V42 이후 nullable 로 추가된다")
    void addsNullableAchievedAtColumnAtV42() {
        seedAt("41");
        assertThat(hasColumn("group_challenge_bet_participants", "achieved_at")).isFalse();
        // V42 이전에 이미 존재하던 참가 행 — 마이그레이션 후 null 로 남아야 한다.
        UUID legacyParticipant = insertParticipant();

        migrate("42");

        assertThat(hasColumn("group_challenge_bet_participants", "achieved_at")).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT achieved_at FROM group_challenge_bet_participants WHERE id = ?",
                java.time.OffsetDateTime.class, legacyParticipant)).isNull();

        // 조기 확정 시각 저장·조회 — confirmWin 이 쓰는 그대로.
        jdbc.update("UPDATE group_challenge_bet_participants"
                + " SET achieved = true, achieved_at = now() WHERE id = ?", legacyParticipant);
        assertThat(jdbc.queryForObject(
                "SELECT achieved_at FROM group_challenge_bet_participants WHERE id = ?",
                java.time.OffsetDateTime.class, legacyParticipant)).isNotNull();
    }

    // ── 시드 (V41 테스트 관례) ───────────────────────────────────────────

    private void seedAt(String target) {
        migrate(target);
        userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, created_at, is_guest, nickname, is_deleted)"
                + " VALUES (?, now(), false, '재영', false)", userId);
        groupId = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name,"
                + " status) VALUES (?, false, 'OWNER_ONLY', 10, '스터디', 'ACTIVE')", groupId);
        challengeId = UUID.randomUUID();
        StringBuilder columns = new StringBuilder("id, group_id, category, type, status, created_at");
        StringBuilder values = new StringBuilder("?, ?, 'FOCUS', 'DURATION', 'ACTIVE', now()");
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
        configId = UUID.randomUUID();
        jdbc.update("INSERT INTO group_challenge_bets (id, group_id, challenge_id, stake, enabled,"
                + " created_at, updated_at) VALUES (?, ?, ?, 30, true, now(), now())",
                configId, groupId, challengeId);
        sessionId = UUID.randomUUID();
        jdbc.update("INSERT INTO group_challenge_bet_sessions (id, bet_id, group_id, challenge_id,"
                + " session_date, stake, goal_minutes, mission_category, mission_type, status,"
                + " starts_at, join_closes_at, closes_at, settle_after, settle_attempts,"
                + " created_at, updated_at)"
                + " VALUES (?, ?, ?, ?, ?, 30, 120, 'FOCUS', 'DURATION', 'OPEN',"
                + " now(), now(), now(), now(), 0, now(), now())",
                sessionId, configId, groupId, challengeId, TODAY);
    }

    private UUID insertParticipant() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO group_challenge_bet_participants (id, session_id, user_id, created_at)"
                + " VALUES (?, ?, ?, now())", id, sessionId, userId);
        return id;
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
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다(V41 테스트 관례) — 선행
     * 배치(B1·B2)의 V34~V38 이 아직 없는 워크트리에서는 "41" 이 그대로, 머지 후에도 41 로
     * 해석된다(Flyway 는 존재하지 않는 target 을 오류로 본다).
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
