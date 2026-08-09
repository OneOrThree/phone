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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V20 마이그레이션의 실 SQL 검증 — 그룹 챌린지 확장 스키마(내기 상태 확장·창 목표분·창 사용분 보고·활성 중복 강제).
 *
 * <p>V20 은 V19 인라인 CHECK 와 Hibernate 자동명 유니크를 <b>이름-무관 DO $$</b> 로 드롭한다. 신선 체인의
 * 자동 생성명뿐 아니라 이름이 다른 환경(레거시/수동 개입)에서도 동작해야 하므로, {@code LeagueLegacyMigrationTest}
 * 의 프로덕션식 rename 시나리오를 재사용해 이름 의존이 없음을 검증한다.
 *
 * <p>활성 중복 정리 UPDATE 는 마이그레이션 시점에 한 번 실행되는 데이터 정리라 애플리케이션 테스트로는 커버되지
 * 않는다 — 기존 dev 데이터에 중복이 있는 상태를 여기서 재현한다.
 */
class GroupChallengeV20MigrationTest {

    /**
     * 이 클래스 전용 컨테이너. 공용 {@code TestPostgres} 는 다른 테스트 클래스들이 공유하는 Spring 컨텍스트의
     * 데이터소스라, 아래 {@link #resetSchema()} 의 스키마 초기화와 함께 쓸 수 없다.
     */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("기존 활성 (group, category, type) 중복은 최신 1건만 남기고 soft delete 후 부분 유니크로 재발 차단")
    void cleansDuplicateActiveChallengesAndEnforcesUniqueness() {
        migrate(MigrationVersion.fromVersion("19"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroup(jdbcTemplate);
        UUID oldest = insertChallenge(jdbcTemplate, "DURATION", "FOCUS", daysAgo(3));
        UUID middle = insertChallenge(jdbcTemplate, "DURATION", "FOCUS", daysAgo(2));
        UUID latest = insertChallenge(jdbcTemplate, "DURATION", "FOCUS", daysAgo(1));
        UUID otherCombo = insertChallenge(jdbcTemplate, "TIME_WINDOW", "FOCUS", daysAgo(1));

        migrate(MigrationVersion.LATEST);

        assertThat(softDeleted(jdbcTemplate, oldest)).isTrue();
        assertThat(softDeleted(jdbcTemplate, middle)).isTrue();
        assertThat(softDeleted(jdbcTemplate, latest)).isFalse();
        assertThat(softDeleted(jdbcTemplate, otherCombo)).isFalse();

        // 부분 유니크: 같은 조합의 ACTIVE 재삽입은 거부, 다른 조합은 허용
        assertThatThrownBy(() -> insertCurrentChallenge(jdbcTemplate, "DURATION", "FOCUS"))
                .isInstanceOf(DataIntegrityViolationException.class);
        insertCurrentChallenge(jdbcTemplate, "DURATION", "SCREEN_TIME");
    }

    @Test
    @DisplayName("created_at 동률이면 id 큰 쪽(UUID v7 = 시간순 후행)이 살아남는다")
    void breaksCreatedAtTiesByLargerId() {
        migrate(MigrationVersion.fromVersion("19"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroup(jdbcTemplate);
        // Postgres 의 uuid 비교는 byte-wise 라 값이 자명한 id 로 순서를 고정한다
        UUID smaller = UUID.fromString("00000000-0000-7000-8000-000000000001");
        UUID larger = UUID.fromString("00000000-0000-7000-8000-000000000002");
        Instant sameCreatedAt = daysAgo(1);
        insertChallenge(jdbcTemplate, smaller, "DURATION", "FOCUS", sameCreatedAt);
        insertChallenge(jdbcTemplate, larger, "DURATION", "FOCUS", sameCreatedAt);

        migrate(MigrationVersion.LATEST);

        assertThat(softDeleted(jdbcTemplate, smaller)).isTrue();
        assertThat(softDeleted(jdbcTemplate, larger)).isFalse();
    }

    @Test
    @DisplayName("프로덕션식 — status CHECK 이름이 자동명과 달라도 드롭되고 FORFEITED/CANCELED 가 열린다")
    void expandsBetStatusDomainNameAgnostically() {
        migrate(MigrationVersion.fromVersion("19"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroup(jdbcTemplate);
        insertUser(jdbcTemplate);
        UUID challengeId = insertChallenge(jdbcTemplate, "DURATION", "FOCUS", daysAgo(1));

        // 자동 생성명(group_challenge_bets_status_check)이 아닌 환경 재현 — DO $$ 가 이름이 아니라
        // status 컬럼 참조(conkey)로 드롭 대상을 찾는지 검증한다.
        jdbcTemplate.execute("ALTER TABLE group_challenge_bets"
                + " RENAME CONSTRAINT group_challenge_bets_status_check TO ck_legacy_renamed_status");

        migrate(MigrationVersion.LATEST);

        insertBet(jdbcTemplate, challengeId, "FORFEITED", LocalDate.of(2026, 8, 1), 30);
        insertBet(jdbcTemplate, challengeId, "CANCELED", LocalDate.of(2026, 8, 2), 30);
        assertThatThrownBy(() -> insertBet(jdbcTemplate, challengeId, "BOGUS", LocalDate.of(2026, 8, 3), 30))
                .isInstanceOf(DataIntegrityViolationException.class);

        // 같은 테이블의 stake CHECK 는 오폭 없이 살아 있어야 한다
        assertThatThrownBy(() -> insertBet(jdbcTemplate, challengeId, "OPEN", LocalDate.of(2026, 8, 4), 0))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("프로덕션식 — members 유니크 이름이 달라도 (challenge, user, usage_date) 로 교체된다")
    void replacesMemberUniqueWithUsageDateDimensionNameAgnostically() {
        migrate(MigrationVersion.fromVersion("19"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroup(jdbcTemplate);
        insertUser(jdbcTemplate);
        UUID challengeId = insertChallenge(jdbcTemplate, "TIME_WINDOW", "SCREEN_TIME", daysAgo(1));
        jdbcTemplate.execute("ALTER TABLE group_challenge_members"
                + " RENAME CONSTRAINT ukiwe9880osh6noglltq8seipts TO uk_legacy_renamed_member");

        migrate(MigrationVersion.LATEST);

        // 날짜별 보고 1행 — 다른 날짜는 허용, 같은 (챌린지, 유저, 날짜) 는 거부
        insertMember(jdbcTemplate, challengeId, LocalDate.of(2026, 8, 1));
        insertMember(jdbcTemplate, challengeId, LocalDate.of(2026, 8, 2));
        assertThatThrownBy(() -> insertMember(jdbcTemplate, challengeId, LocalDate.of(2026, 8, 2)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("창 목표분 — 양수만 허용하고 null 은 기존 창 챌린지(판정불가)로 남는다")
    void addsNullableWindowGoalWithPositiveCheck() {
        migrate(MigrationVersion.LATEST);
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroup(jdbcTemplate);
        UUID challengeId = insertCurrentChallenge(jdbcTemplate, "TIME_WINDOW", "FOCUS");

        insertWindow(jdbcTemplate, challengeId, 120);
        assertThatThrownBy(() -> jdbcTemplate.update(
                "UPDATE group_challenge_windows SET duration_minutes = 0 WHERE challenge_id = ?", challengeId))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbcTemplate.update(
                "UPDATE group_challenge_windows SET duration_minutes = NULL WHERE challenge_id = ?", challengeId);
    }

    private boolean softDeleted(JdbcTemplate jdbcTemplate, UUID challengeId) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT deleted_at IS NOT NULL FROM group_challenges WHERE id = ?", Boolean.class, challengeId));
    }

    private Instant daysAgo(int days) {
        return Instant.parse("2026-08-01T00:00:00Z").minusSeconds(days * 86_400L);
    }

    private void insertGroup(JdbcTemplate jdbcTemplate) {
        jdbcTemplate.update(
                "INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status)"
                        + " VALUES (?, false, 'OWNER_ONLY', 10, '검증그룹', 'ACTIVE')",
                GROUP_ID);
    }

    private void insertUser(JdbcTemplate jdbcTemplate) {
        jdbcTemplate.update(
                "INSERT INTO users (id, created_at, is_guest, nickname) VALUES (?, now(), false, '재영')",
                USER_ID);
    }

    /** V19 시점 스키마용(= V32 이전) — repeat_days·started_at 컬럼이 아직 없다. */
    private UUID insertChallenge(JdbcTemplate jdbcTemplate, String type, String category, Instant createdAt) {
        return insertChallenge(jdbcTemplate, UUID.randomUUID(), type, category, createdAt);
    }

    /** LATEST(= V32 이후) 스키마용 — repeat_days·started_at 은 NOT NULL 이고 기본값이 없다. */
    private UUID insertCurrentChallenge(JdbcTemplate jdbcTemplate, String type, String category) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO group_challenges"
                        + " (id, group_id, type, category, status, repeat_days, started_at, created_at)"
                        + " VALUES (?, ?, ?, ?, 'ACTIVE', 127, now(), now())",
                id, GROUP_ID, type, category);
        return id;
    }

    private UUID insertChallenge(JdbcTemplate jdbcTemplate, UUID id, String type, String category, Instant createdAt) {
        jdbcTemplate.update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at)"
                        + " VALUES (?, ?, ?, ?, 'ACTIVE', ?)",
                id, GROUP_ID, type, category, Timestamp.from(createdAt));
        return id;
    }

    private void insertBet(JdbcTemplate jdbcTemplate, UUID challengeId, String status, LocalDate betDate, int stake) {
        jdbcTemplate.update(
                "INSERT INTO group_challenge_bets"
                        + " (id, group_id, challenge_id, creator_user_id, stake, bet_date, status,"
                        + " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, now(), now())",
                UUID.randomUUID(), GROUP_ID, challengeId, USER_ID, stake, Date.valueOf(betDate), status);
    }

    private void insertMember(JdbcTemplate jdbcTemplate, UUID challengeId, LocalDate usageDate) {
        // V32: is_achieved 잔재 컬럼은 제거됐다(GROMO-1265).
        jdbcTemplate.update(
                "INSERT INTO group_challenge_members"
                        + " (id, created_at, progress_minutes, group_challenge_id, user_id, usage_date)"
                        + " VALUES (?, now(), 0, ?, ?, ?)",
                UUID.randomUUID(), challengeId, USER_ID, Date.valueOf(usageDate));
    }

    private void insertWindow(JdbcTemplate jdbcTemplate, UUID challengeId, Integer durationMinutes) {
        // V32: 창 시각은 KST 벽시계 time 이고 컬럼명도 window_start/window_end 다(GROMO-1263).
        jdbcTemplate.update(
                "INSERT INTO group_challenge_windows"
                        + " (challenge_id, window_start, window_end, duration_minutes)"
                        + " VALUES (?, time '09:00', time '12:00', ?)",
                challengeId, durationMinutes);
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
