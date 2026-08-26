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
 * V40(참가비 상한 3,000 CHECK, GROMO-1264·N30)의 실 SQL 검증.
 *
 * <p>보는 것: ① 기존 범위 밖 행(구 스키마 시절 상한 1,000 을 넘긴 이상치)이 상한으로 클램프된다
 * (V28 관행 — plain CHECK 는 기존 행을 즉시 검증하므로 클램프 없이는 배포가 막힌다),
 * ② 설정·회차 <b>양쪽</b>에 CHECK (stake BETWEEN 1 AND 3000) 이 실재한다 — 경계값 1·3000 허용,
 * 0·3001 거절.
 */
class GroupBetV40MigrationTest {

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
    @DisplayName("범위 밖 기존 행은 상한 3,000 으로 클램프된다 — 설정·회차(박제값) 양쪽")
    void clampsOutOfRangeRowsBeforeAddingCheck() {
        seedAt("39");
        // V40 이전엔 하한 CHECK(> 0)뿐이라 5000 도 저장된다 — 상한 위반 이상치를 재현.
        jdbc.update("UPDATE group_challenge_bets SET stake = 5000 WHERE id = ?", configId);
        UUID oversizedSessionId = insertSession(TODAY, 5000);

        migrate("40");

        assertThat(jdbc.queryForObject("SELECT stake FROM group_challenge_bets WHERE id = ?",
                Integer.class, configId)).isEqualTo(3000);
        assertThat(jdbc.queryForObject("SELECT stake FROM group_challenge_bet_sessions WHERE id = ?",
                Integer.class, oversizedSessionId)).isEqualTo(3000);
    }

    @Test
    @DisplayName("CHECK (stake BETWEEN 1 AND 3000) — 경계값 1·3000 은 통과, 0·3001 은 양쪽 테이블에서 거절된다")
    void enforcesStakeRangeOnBothTables() {
        seedAt("39");
        migrate("40");

        // 회차 — 경계 허용.
        insertSession(TODAY.plusDays(1), 1);
        insertSession(TODAY.plusDays(2), 3000);
        // 회차 — 범위 밖 거절.
        assertThatThrownBy(() -> insertSession(TODAY.plusDays(3), 0))
                .hasMessageContaining("group_challenge_bet_sessions_stake_check");
        assertThatThrownBy(() -> insertSession(TODAY.plusDays(4), 3001))
                .hasMessageContaining("group_challenge_bet_sessions_stake_check");
        // 설정 — 경계 허용·범위 밖 거절.
        jdbc.update("UPDATE group_challenge_bets SET stake = 3000 WHERE id = ?", configId);
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE group_challenge_bets SET stake = 3001 WHERE id = ?", configId))
                .hasMessageContaining("group_challenge_bets_stake_check");
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE group_challenge_bets SET stake = 0 WHERE id = ?", configId))
                .hasMessageContaining("group_challenge_bets_stake_check");
    }

    // ── 시드 ────────────────────────────────────────────────────────────

    /** V39(2계층)까지 올린 스키마에 설정 1행을 심는다 — 회차는 테스트별로 추가한다. */
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

    private UUID insertSession(LocalDate date, int stake) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO group_challenge_bet_sessions (id, bet_id, group_id, challenge_id,"
                + " session_date, stake, goal_minutes, mission_category, mission_type, status,"
                + " starts_at, join_closes_at, closes_at, settle_after, settle_attempts,"
                + " created_at, updated_at)"
                + " VALUES (?, ?, ?, ?, ?, ?, 120, 'FOCUS', 'DURATION', 'OPEN',"
                + " now(), now(), now(), now(), 0, now(), now())",
                id, configId, groupId, challengeId, date, stake);
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
