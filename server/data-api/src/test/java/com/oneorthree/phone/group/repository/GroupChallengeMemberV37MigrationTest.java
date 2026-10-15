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

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V37 마이그레이션의 실 SQL 검증 — group_challenge_members 잔재 정리(GROMO-1265 · GROMO-1266).
 *
 * <p>보는 것 세 가지: ① usage_date NULL 잔재 행은 삭제되고 날짜 있는 보고 행은 값 그대로 보존된다
 * (백필 규칙 = 삭제 — V37 주석 참조), ② usage_date 는 NOT NULL 로 승격돼 NULL 삽입이 거부된다,
 * ③ is_achieved · achieved_at 컬럼은 드롭된다. 검증 방식은 {@link GroupMemberV31MigrationTest}
 * 선례 — 전용 컨테이너에 Flyway 체인을 실제로 돌리고, V37 직전 스키마에 잔재 상태를 재현한 뒤 적용한다.
 */
class GroupChallengeMemberV37MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID CHALLENGE_ID = UUID.randomUUID();
    private static final UUID LEGACY_ROW_ID = UUID.randomUUID();
    private static final UUID DATED_ROW_ID = UUID.randomUUID();
    private static final LocalDate USAGE_DATE = LocalDate.of(2026, 8, 1);

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("usage_date NULL 잔재 행은 삭제되고, 날짜 있는 보고 행은 보고값 그대로 보존된다")
    void deletesNullUsageDateRowsAndKeepsDatedReports() {
        givenPreV37StateWithLegacyRows();

        migrate(MigrationVersion.fromVersion("37"));

        JdbcTemplate jdbcTemplate = jdbcTemplate();
        List<UUID> remaining = jdbcTemplate.queryForList(
                "SELECT id FROM group_challenge_members", UUID.class);
        assertThat(remaining).containsExactly(DATED_ROW_ID);
        // 살아남은 보고 행의 원본값(보고 분·날짜)은 불변이다.
        assertThat(jdbcTemplate.queryForObject(
                "SELECT progress_minutes FROM group_challenge_members WHERE id = ?",
                Integer.class, DATED_ROW_ID)).isEqualTo(42);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT usage_date FROM group_challenge_members WHERE id = ?",
                LocalDate.class, DATED_ROW_ID)).isEqualTo(USAGE_DATE);
    }

    @Test
    @DisplayName("usage_date 는 NOT NULL 로 승격 — NULL 삽입은 거부되고 날짜 있는 삽입은 허용된다")
    void promotesUsageDateToNotNull() {
        givenPreV37StateWithLegacyRows();

        migrate(MigrationVersion.fromVersion("37"));

        JdbcTemplate jdbcTemplate = jdbcTemplate();
        assertThatThrownBy(() -> jdbcTemplate.update(
                "INSERT INTO group_challenge_members"
                        + " (id, created_at, progress_minutes, group_challenge_id, user_id, usage_date)"
                        + " VALUES (?, now(), 0, ?, ?, NULL)",
                UUID.randomUUID(), CHALLENGE_ID, USER_ID))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbcTemplate.update(
                "INSERT INTO group_challenge_members"
                        + " (id, created_at, progress_minutes, group_challenge_id, user_id, usage_date)"
                        + " VALUES (?, now(), 0, ?, ?, ?)",
                UUID.randomUUID(), CHALLENGE_ID, USER_ID, Date.valueOf(USAGE_DATE.plusDays(1)));
    }

    @Test
    @DisplayName("is_achieved · achieved_at 컬럼은 드롭된다 (저장 시 판정 모델의 잔재 제거)")
    void dropsAchievedResidueColumns() {
        givenPreV37StateWithLegacyRows();

        migrate(MigrationVersion.fromVersion("37"));

        List<String> columns = jdbcTemplate().queryForList(
                "SELECT column_name FROM information_schema.columns"
                        + " WHERE table_name = 'group_challenge_members'", String.class);
        assertThat(columns).doesNotContain("is_achieved", "achieved_at")
                .contains("usage_date", "progress_minutes");
    }

    /**
     * V33 까지 올린 스키마에 잔재 상태를 재현한다 — usage_date NULL 잔재 행(구 스키마 시절) 1건 +
     * 정상 날짜 보고 행 1건. Flyway target 은 실존 버전이어야 해서 이 워크트리의 V37 직전인 33 을
     * 쓴다 — V34~36(B1 배정)이 합류해도 migrate(37) 이 그 사이 체인을 마저 적용하므로 유효하다.
     */
    private void givenPreV37StateWithLegacyRows() {
        migrate(MigrationVersion.fromVersion("33"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.update(
                "INSERT INTO users (id, created_at, is_guest, nickname) VALUES (?, now(), false, '재영')",
                USER_ID);
        jdbcTemplate.update(
                "INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status)"
                        + " VALUES (?, false, 'OWNER_ONLY', 10, '검증그룹', 'ACTIVE')",
                GROUP_ID);
        jdbcTemplate.update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at)"
                        + " VALUES (?, ?, 'TIME_WINDOW', 'SCREEN_TIME', 'ACTIVE', ?)",
                CHALLENGE_ID, GROUP_ID, Timestamp.from(Instant.parse("2026-07-01T00:00:00Z")));
        // 잔재 행 — usage_date NULL (V20 이전 미사용 시절 형태), is_achieved 는 구 컬럼이 아직 있다.
        jdbcTemplate.update(
                "INSERT INTO group_challenge_members"
                        + " (id, created_at, is_achieved, progress_minutes, group_challenge_id, user_id, usage_date)"
                        + " VALUES (?, now(), false, 7, ?, ?, NULL)",
                LEGACY_ROW_ID, CHALLENGE_ID, USER_ID);
        // 정상 보고 행 — 날짜별 창 사용분 보고(V20 이후 유일한 쓰기 경로 형태).
        jdbcTemplate.update(
                "INSERT INTO group_challenge_members"
                        + " (id, created_at, is_achieved, progress_minutes, group_challenge_id, user_id, usage_date)"
                        + " VALUES (?, now(), false, 42, ?, ?, ?)",
                DATED_ROW_ID, CHALLENGE_ID, USER_ID, Date.valueOf(USAGE_DATE));
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
