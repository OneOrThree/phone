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
 * V34(요일 반복 + 수명주기) 실 SQL 검증 — GROMO-1260 · GROMO-1261.
 *
 * <p>보는 것: ① 기존 행 백필(repeat_days=127 · started_at=created_at), ② 레거시 INACTIVE →
 * ENDED 복원 + ended_at 근사 백필(created_at), ③ CHECK — repeat_days 0·128 거부, 되돌린
 * status CHECK 가 INACTIVE 를 거부. 검증 방식은 {@link GroupMemberV31MigrationTest} 선례를 따라
 * 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 */
class GroupChallengeV34MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID ACTIVE_CHALLENGE_ID = UUID.randomUUID();
    private static final UUID INACTIVE_CHALLENGE_ID = UUID.randomUUID();

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("기존 행 백필 — repeat_days=127(매일) · started_at=created_at · ACTIVE 는 ended_at null")
    void backfillsRepeatDaysAndStartedAt() {
        givenV33StateWithChallenges();

        migrate(MigrationVersion.fromVersion("34"));

        Map<String, Object> active = challengeOf(ACTIVE_CHALLENGE_ID);
        assertThat(((Number) active.get("repeat_days")).intValue()).isEqualTo(127);
        assertThat(active.get("started_at")).isEqualTo(active.get("created_at"));
        assertThat(active.get("status")).isEqualTo("ACTIVE");
        assertThat(active.get("ended_at")).isNull();
    }

    @Test
    @DisplayName("레거시 INACTIVE → ENDED 복원 — ended_at 은 실제 종료 시각 유실이라 created_at 근사 백필")
    void restoresLegacyInactiveToEnded() {
        givenV33StateWithChallenges();

        migrate(MigrationVersion.fromVersion("34"));

        Map<String, Object> ended = challengeOf(INACTIVE_CHALLENGE_ID);
        assertThat(ended.get("status")).isEqualTo("ENDED");
        assertThat(ended.get("ended_at")).isEqualTo(ended.get("created_at"));
        // 요일·시작 백필은 상태와 무관하게 전 행 대상이다.
        assertThat(((Number) ended.get("repeat_days")).intValue()).isEqualTo(127);
    }

    @Test
    @DisplayName("CHECK — repeat_days 0(요일 없음)·128(범위 밖)과 status 'INACTIVE' 는 저장이 거부된다")
    void enforcesRepeatDaysAndStatusChecks() {
        givenV33StateWithChallenges();
        migrate(MigrationVersion.fromVersion("34"));

        assertThatThrownBy(() -> insertChallenge(UUID.randomUUID(), "ACTIVE", 0))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertChallenge(UUID.randomUUID(), "ACTIVE", 128))
                .isInstanceOf(DataIntegrityViolationException.class);
        // V2 가 만든 INACTIVE 는 이제 유효한 상태가 아니다 — 정본(§A8)은 ACTIVE/ENDED 뿐.
        assertThatThrownBy(() -> insertChallenge(UUID.randomUUID(), "INACTIVE", 127))
                .isInstanceOf(DataIntegrityViolationException.class);
        insertChallenge(UUID.randomUUID(), "ENDED", 127);   // 정본 상태는 통과
    }

    /** V33 까지 올린 스키마에 ACTIVE 1건 + 레거시 INACTIVE 1건을 심는다(created_at 고정 리터럴). */
    private void givenV33StateWithChallenges() {
        migrate(MigrationVersion.fromVersion("33"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.update(
                "INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status)"
                        + " VALUES (?, false, 'OWNER_ONLY', 10, '백필검증방', 'ACTIVE')",
                GROUP_ID);
        jdbcTemplate.update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at)"
                        + " VALUES (?, ?, 'DURATION', 'FOCUS', 'ACTIVE', timestamptz '2026-08-01 09:00:00+09')",
                ACTIVE_CHALLENGE_ID, GROUP_ID);
        jdbcTemplate.update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at)"
                        + " VALUES (?, ?, 'DURATION', 'SCREEN_TIME', 'INACTIVE', timestamptz '2026-07-01 09:00:00+09')",
                INACTIVE_CHALLENGE_ID, GROUP_ID);
    }

    /** V34 이후 삽입 — repeat_days·started_at NOT NULL 이므로 값을 채워 넣는다. */
    private void insertChallenge(UUID id, String status, int repeatDays) {
        jdbcTemplate().update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at,"
                        + " repeat_days, started_at)"
                        + " VALUES (?, ?, 'TIME_WINDOW', 'FOCUS', ?, now(), ?, now())",
                id, GROUP_ID, status, repeatDays);
    }

    private Map<String, Object> challengeOf(UUID id) {
        return jdbcTemplate().queryForMap(
                "SELECT status, repeat_days, created_at, started_at, ended_at FROM group_challenges WHERE id = ?",
                id);
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
