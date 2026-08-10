package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Date;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V29 마이그레이션의 실 SQL 검증 — 내기 정산 근거 컬럼(GROMO-1207,
 * {@code group_challenge_bets.goal_minutes} · {@code group_challenge_bet_participants.progress_minutes}).
 *
 * <p>보는 것 세 가지: ① 두 컬럼이 실제로 생기고 NULL 을 허용한다(백필 없음 정책의 전제 — NOT NULL
 * 이면 기존 행 때문에 마이그레이션이 실패해 배포가 막힌다), ② V28 까지의 스키마에서 만들어진
 * <b>기존 행</b>이 값 변경 없이 NULL 로 남는다(과거 정산은 재구성하지 않는다 — 앱이 "—" 로 그린다),
 * ③ 새 행에는 값이 저장된다. 검증 방식은 {@link GroupChallengeV28MigrationTest} 선례를 따라 전용
 * 컨테이너에 Flyway 체인을 실제로 돌린다.
 */
class GroupBetV29MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final LocalDate BET_DATE = LocalDate.of(2026, 8, 5);

    /**
     * 이 테스트의 종착 스키마 — V33 고정. V34+ 가 이 시대의 전제를 재정의한다(repeat_days·started_at
     * NOT NULL, 창 컬럼 time 전환·개명, V20 부분 유니크 완화, V28 상한 CHECK 교체). 그 이후 규약은
     * {@code GroupChallengeV34~V36MigrationTest} 가 잇고, 여기는 해당 마이그레이션 시대의 계약을 지킨다.
     */
    private static final MigrationVersion ERA_END = MigrationVersion.fromVersion("33");

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("정산 근거 컬럼이 생기고 NULL 을 허용한다 — 근거 없는(V29 이전 규약) INSERT 도 통과")
    void addsNullableEvidenceColumns() {
        migrate(ERA_END);
        JdbcTemplate jdbcTemplate = jdbcTemplate();

        assertThat(columnNullable(jdbcTemplate, "group_challenge_bets", "goal_minutes"))
                .isEqualTo("YES");
        assertThat(columnNullable(jdbcTemplate, "group_challenge_bet_participants", "progress_minutes"))
                .isEqualTo("YES");

        // 근거 없이도 행이 성립한다 — OPEN 내기·정산 전 참가 행의 정상 상태다.
        insertGroupAndUser(jdbcTemplate);
        UUID betId = insertBet(jdbcTemplate, insertChallenge(jdbcTemplate));
        insertParticipant(jdbcTemplate, betId);
        assertThat(evidenceOf(jdbcTemplate, betId)).containsExactly(null, null);
    }

    @Test
    @DisplayName("V28 시절의 기존 행은 V29 이후에도 NULL 그대로다 — 백필하지 않는다(과거분은 앱이 '—' 표시)")
    void keepsExistingRowsNullWithoutBackfill() {
        // V28 까지만 올린 스키마에 정산 근거 이전 시절의 행을 재현한다.
        migrate(MigrationVersion.fromVersion("28"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID betId = insertBet(jdbcTemplate, insertChallenge(jdbcTemplate));
        insertParticipant(jdbcTemplate, betId);

        migrate(ERA_END);

        assertThat(evidenceOf(jdbcTemplate, betId)).containsExactly(null, null);
    }

    @Test
    @DisplayName("새 정산 규약의 값 저장이 성립한다 — goal_minutes·progress_minutes UPDATE 반영")
    void storesEvidenceValuesOnNewSettlements() {
        migrate(ERA_END);
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID betId = insertBet(jdbcTemplate, insertChallenge(jdbcTemplate));
        insertParticipant(jdbcTemplate, betId);

        jdbcTemplate.update(
                "UPDATE group_challenge_bets SET goal_minutes = 120 WHERE id = ?", betId);
        jdbcTemplate.update(
                "UPDATE group_challenge_bet_participants SET progress_minutes = 52 WHERE bet_id = ?",
                betId);

        assertThat(evidenceOf(jdbcTemplate, betId)).containsExactly(120, 52);
    }

    /** 내기의 (goal_minutes, 참가자 progress_minutes) 쌍 — 정산 근거 저장 상태를 한 번에 읽는다. */
    private Integer[] evidenceOf(JdbcTemplate jdbcTemplate, UUID betId) {
        Map<String, Object> row = jdbcTemplate.queryForMap(
                "SELECT b.goal_minutes, p.progress_minutes FROM group_challenge_bets b "
                        + "JOIN group_challenge_bet_participants p ON p.bet_id = b.id WHERE b.id = ?",
                betId);
        return new Integer[] {(Integer) row.get("goal_minutes"), (Integer) row.get("progress_minutes")};
    }

    private String columnNullable(JdbcTemplate jdbcTemplate, String table, String column) {
        return jdbcTemplate.queryForObject(
                "SELECT is_nullable FROM information_schema.columns "
                        + "WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
                String.class, table, column);
    }

    private void insertGroupAndUser(JdbcTemplate jdbcTemplate) {
        jdbcTemplate.update(
                "INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status)"
                        + " VALUES (?, false, 'OWNER_ONLY', 10, '검증그룹', 'ACTIVE')",
                GROUP_ID);
        jdbcTemplate.update(
                "INSERT INTO users (id, created_at, is_guest, nickname) VALUES (?, now(), false, '재영')",
                USER_ID);
    }

    private UUID insertChallenge(JdbcTemplate jdbcTemplate) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at)"
                        + " VALUES (?, ?, 'DURATION', 'FOCUS', 'ACTIVE', now())",
                id, GROUP_ID);
        return id;
    }

    private UUID insertBet(JdbcTemplate jdbcTemplate, UUID challengeId) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO group_challenge_bets"
                        + " (id, group_id, challenge_id, creator_user_id, stake, bet_date, status,"
                        + " created_at, updated_at) VALUES (?, ?, ?, ?, 30, ?, 'SETTLED', now(), now())",
                id, GROUP_ID, challengeId, USER_ID, Date.valueOf(BET_DATE));
        return id;
    }

    private void insertParticipant(JdbcTemplate jdbcTemplate, UUID betId) {
        jdbcTemplate.update(
                "INSERT INTO group_challenge_bet_participants (id, bet_id, user_id, created_at)"
                        + " VALUES (?, ?, ?, now())",
                UUID.randomUUID(), betId, USER_ID);
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
