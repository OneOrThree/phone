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
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V41(void_reason + UNUSED, GROMO-1404·N33·N52)의 실 SQL 검증.
 *
 * <p>보는 것: ① 종료 상태에 UNUSED(참가자 0명 전용)가 추가된다 — V40 까지는 거절되던 값이다,
 * ② void_reason 은 등록된 3종(INSUFFICIENT_PARTICIPANTS·CHALLENGE_DELETED·REFUND_DEADLINE)만
 * 허용하고 null 이 기본이다, ③ 미등록 사유는 CHECK 가 거절한다.
 */
class GroupBetV41MigrationTest {

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

    @BeforeEach
    void resetSchema() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V40 까지는 UNUSED 가 status CHECK 에 없다 — V41 이후 허용된다")
    void unusedStatusBecomesValidAtV41() {
        seedAt("40");
        assertThatThrownBy(() -> insertSession(TODAY, "UNUSED", null))
                .hasMessageContaining("group_challenge_bet_sessions_status_check");

        migrate("41");

        UUID unusedId = insertSession(TODAY.plusDays(1), "UNUSED", null);
        assertThat(jdbc.queryForObject(
                "SELECT status FROM group_challenge_bet_sessions WHERE id = ?", String.class, unusedId))
                .isEqualTo("UNUSED");
    }

    @Test
    @DisplayName("void_reason — 등록 3종은 저장되고, 미등록 값은 CHECK 가 거절하며, 기본은 null 이다")
    void enforcesVoidReasonDomain() {
        seedAt("41");

        UUID voided = insertSession(TODAY, "VOIDED", "INSUFFICIENT_PARTICIPANTS");
        UUID deleted = insertSession(TODAY.plusDays(1), "VOIDED", "CHALLENGE_DELETED");
        UUID refunded = insertSession(TODAY.plusDays(2), "REFUNDED", "REFUND_DEADLINE");
        UUID open = insertSession(TODAY.plusDays(3), "OPEN", null);

        assertThat(jdbc.queryForObject(
                "SELECT void_reason FROM group_challenge_bet_sessions WHERE id = ?",
                String.class, voided)).isEqualTo("INSUFFICIENT_PARTICIPANTS");
        assertThat(jdbc.queryForObject(
                "SELECT void_reason FROM group_challenge_bet_sessions WHERE id = ?",
                String.class, deleted)).isEqualTo("CHALLENGE_DELETED");
        assertThat(jdbc.queryForObject(
                "SELECT void_reason FROM group_challenge_bet_sessions WHERE id = ?",
                String.class, refunded)).isEqualTo("REFUND_DEADLINE");
        assertThat(jdbc.queryForObject(
                "SELECT void_reason FROM group_challenge_bet_sessions WHERE id = ?",
                String.class, open)).isNull();

        assertThatThrownBy(() -> insertSession(TODAY.plusDays(4), "VOIDED", "SOMETHING_ELSE"))
                .hasMessageContaining("group_challenge_bet_sessions_void_reason_check");
    }

    // ── 시드 ────────────────────────────────────────────────────────────

    private void seedAt(String target) {
        migrate(target);
        UUID userId = UUID.randomUUID();
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
    }

    private UUID insertSession(LocalDate date, String status, String voidReason) {
        UUID id = UUID.randomUUID();
        String voidReasonColumn = hasColumn("group_challenge_bet_sessions", "void_reason")
                ? ", void_reason" : "";
        String voidReasonValue = voidReasonColumn.isEmpty() ? "" : ", ?";
        Object[] args = voidReasonColumn.isEmpty()
                ? new Object[] {id, configId, groupId, challengeId, date, status}
                : new Object[] {id, configId, groupId, challengeId, date, status, voidReason};
        jdbc.update("INSERT INTO group_challenge_bet_sessions (id, bet_id, group_id, challenge_id,"
                + " session_date, stake, goal_minutes, mission_category, mission_type, status,"
                + " starts_at, join_closes_at, closes_at, settle_after, settle_attempts,"
                + " created_at, updated_at" + voidReasonColumn + ")"
                + " VALUES (?, ?, ?, ?, ?, 30, 120, 'FOCUS', 'DURATION', ?,"
                + " now(), now(), now(), now(), 0, now(), now()" + voidReasonValue + ")",
                args);
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
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다 — 선행 배치(B1·B2)의 V34~V38 이
     * 아직 없는 워크트리에서는 "38" 이 33 으로, 머지 후에는 38 그대로 해석된다(Flyway 는 존재하지
     * 않는 target 을 오류로 본다).
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
