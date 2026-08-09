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
 * V36(하루형 목표 상한 + 유니크 완화) 실 SQL 검증 — GROMO-1405 · GROMO-1422 · N51 · FR-1·3.
 *
 * <p>보는 것: ① durations.category 백필 + 상한 밖 기존 행 경계 클램프(FOCUS 1440→1080 ·
 * SCREEN_TIME 1000→720), ② 카테고리별 CHECK — FOCUS 1081·SCREEN_TIME 721 거부, ③ 복합 FK —
 * 부모와 다른 category 거부, ④ V20 유니크 완화 — 같은 (그룹, 카테고리) 활성 창형 복수 허용,
 * 하루형은 여전히 1개. 검증 방식은 {@link GroupMemberV31MigrationTest} 선례를 따른다.
 */
class GroupChallengeV36MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID FOCUS_DURATION_ID = UUID.randomUUID();
    private static final UUID SCREEN_DURATION_ID = UUID.randomUUID();

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("category 백필 + 상한 밖 기존 행 경계 클램프 — FOCUS 1440→1080 · SCREEN_TIME 1000→720")
    void backfillsCategoryAndClampsOverCapRows() {
        givenV35StateWithDurations();

        migrate(MigrationVersion.fromVersion("36"));

        Map<String, Object> focus = durationOf(FOCUS_DURATION_ID);
        assertThat(focus.get("category")).isEqualTo("FOCUS");
        assertThat(((Number) focus.get("duration_minutes")).intValue()).isEqualTo(1080);
        Map<String, Object> screen = durationOf(SCREEN_DURATION_ID);
        assertThat(screen.get("category")).isEqualTo("SCREEN_TIME");
        assertThat(((Number) screen.get("duration_minutes")).intValue()).isEqualTo(720);
    }

    @Test
    @DisplayName("카테고리별 상한 CHECK — FOCUS 1081·SCREEN_TIME 721 거부, 경계값(1080·720)은 허용")
    void enforcesCategoryCaps() {
        givenV35StateWithDurations();
        migrate(MigrationVersion.fromVersion("36"));

        UUID focusOver = insertChallenge("DURATION", "FOCUS", "ENDED");
        assertThatThrownBy(() -> insertDuration(focusOver, "FOCUS", 1081))
                .isInstanceOf(DataIntegrityViolationException.class);
        UUID screenOver = insertChallenge("DURATION", "SCREEN_TIME", "ENDED");
        assertThatThrownBy(() -> insertDuration(screenOver, "SCREEN_TIME", 721))
                .isInstanceOf(DataIntegrityViolationException.class);

        insertDuration(focusOver, "FOCUS", 1080);
        insertDuration(screenOver, "SCREEN_TIME", 720);
    }

    @Test
    @DisplayName("복합 FK (challenge_id, category) — 부모와 다른 카테고리의 상세 행은 거부된다")
    void enforcesParentCategoryViaCompositeForeignKey() {
        givenV35StateWithDurations();
        migrate(MigrationVersion.fromVersion("36"));

        UUID parent = insertChallenge("DURATION", "FOCUS", "ENDED");
        // 부모는 FOCUS 인데 상세가 SCREEN_TIME 을 주장 — 단일 CHECK 라면 720 이하로 통과했을 값이
        // FK 에서 걸린다(서비스 우회 경로까지 DB 가 막는다는 것이 이 제약의 존재 이유다).
        assertThatThrownBy(() -> insertDuration(parent, "SCREEN_TIME", 300))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("유니크 완화 — 같은 (그룹, 카테고리) 활성 창형은 복수 허용(FR-3), 활성 하루형은 여전히 1개")
    void relaxesActiveUniqueToDurationOnly() {
        givenV35StateWithDurations();
        migrate(MigrationVersion.fromVersion("36"));

        // 종전 (group_id, category, type) 활성 유니크였다면 두 번째 창형에서 터졌다.
        insertChallenge("TIME_WINDOW", "FOCUS", "ACTIVE");
        insertChallenge("TIME_WINDOW", "FOCUS", "ACTIVE");

        // 하루형은 부분 유니크가 남는다 — 같은 (그룹, 카테고리) 활성 2개째는 거부.
        // (기존 활성 FOCUS 하루형이 givenV35State 에 이미 있다)
        assertThatThrownBy(() -> insertChallenge("DURATION", "FOCUS", "ACTIVE"))
                .isInstanceOf(DataIntegrityViolationException.class);
        // ENDED·소프트 삭제분은 계수되지 않는다 — 부분 유니크의 WHERE 절 검증.
        insertChallenge("DURATION", "SCREEN_TIME", "ENDED");
    }

    /**
     * V35 까지 올린 스키마에 상한 밖 하루형 2건(FOCUS 1440 · SCREEN_TIME 1000)을 심는다 —
     * V28 CHECK(1~1440)로는 전부 유효했던 값이다. 두 챌린지 모두 ACTIVE(부분 유니크 대상).
     */
    private void givenV35StateWithDurations() {
        migrate(MigrationVersion.fromVersion("35"));
        jdbcTemplate().update(
                "INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status)"
                        + " VALUES (?, false, 'OWNER_ONLY', 10, '상한검증방', 'ACTIVE')",
                GROUP_ID);
        insertChallengeWithId(FOCUS_DURATION_ID, "DURATION", "FOCUS", "ACTIVE");
        insertChallengeWithId(SCREEN_DURATION_ID, "DURATION", "SCREEN_TIME", "ACTIVE");
        jdbcTemplate().update(
                "INSERT INTO group_challenge_durations (challenge_id, duration_minutes) VALUES (?, 1440)",
                FOCUS_DURATION_ID);
        jdbcTemplate().update(
                "INSERT INTO group_challenge_durations (challenge_id, duration_minutes) VALUES (?, 1000)",
                SCREEN_DURATION_ID);
    }

    private UUID insertChallenge(String type, String category, String status) {
        UUID id = UUID.randomUUID();
        insertChallengeWithId(id, type, category, status);
        return id;
    }

    private void insertChallengeWithId(UUID id, String type, String category, String status) {
        jdbcTemplate().update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at,"
                        + " repeat_days, started_at)"
                        + " VALUES (?, ?, ?, ?, ?, now(), 127, now())",
                id, GROUP_ID, type, category, status);
    }

    private void insertDuration(UUID challengeId, String category, int minutes) {
        jdbcTemplate().update(
                "INSERT INTO group_challenge_durations (challenge_id, category, duration_minutes)"
                        + " VALUES (?, ?, ?)",
                challengeId, category, minutes);
    }

    private Map<String, Object> durationOf(UUID challengeId) {
        return jdbcTemplate().queryForMap(
                "SELECT category, duration_minutes FROM group_challenge_durations WHERE challenge_id = ?",
                challengeId);
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
