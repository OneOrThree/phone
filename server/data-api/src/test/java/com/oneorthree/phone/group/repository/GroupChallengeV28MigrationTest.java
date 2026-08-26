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
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V28 마이그레이션의 실 SQL 검증 — 내기 (challenge_id, bet_date) 부분 유니크(취소 제외, GROMO-1201)와
 * 일 목표분 상한 CHECK(GROMO-1205).
 *
 * <p><b>여기가 이 제약의 유일한 DB 검증 지점이다.</b> JPA 는 부분 유니크 인덱스를 표현할 수 없어
 * 엔티티의 {@code @UniqueConstraint} 를 제거했고, ci 프로파일(create-drop)로 만든 스키마에는 이
 * 인덱스가 아예 없다 — 그래서 {@code GroupChallengeV20MigrationTest} 와 같은 방식으로 전용
 * 컨테이너에 Flyway 체인을 실제로 돌려 검증한다.
 */
class GroupChallengeV28MigrationTest {

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
    private static final LocalDate BET_DATE = LocalDate.of(2026, 8, 6);

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
    @DisplayName("같은 (챌린지, 날짜)의 비취소 내기 2건은 DB 가 막는다 — 부분 유니크가 동시 개설의 최후 방어선")
    void rejectsSecondNonCanceledBetOnSameChallengeAndDate() {
        migrate();
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID challengeId = insertChallenge(jdbcTemplate);

        insertBet(jdbcTemplate, challengeId, "OPEN", BET_DATE);
        assertThatThrownBy(() -> insertBet(jdbcTemplate, challengeId, "OPEN", BET_DATE))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 비취소끼리는 status 조합과 무관하게 1개다 — 정산 결과 행과 새 OPEN 도 공존할 수 없다.
        assertThatThrownBy(() -> insertBet(jdbcTemplate, challengeId, "SETTLED", BET_DATE))
                .isInstanceOf(DataIntegrityViolationException.class);

        // V19 전체 유니크는 이름으로 드롭됐고, 대체 인덱스가 dbml 과 같은 이름으로 존재한다.
        assertThat(constraintExists(jdbcTemplate, "uq_group_challenge_bets_challenge_bet_date")).isFalse();
        assertThat(indexExists(jdbcTemplate, "uq_group_challenge_bets_challenge_bet_date_active")).isTrue();
        // 휴면 이력 조회(challenge_id IN, CANCELED 포함)용 일반 인덱스 — 부분 유니크로는 못 탄다.
        assertThat(indexExists(jdbcTemplate, "idx_group_challenge_bets_challenge_id")).isTrue();
    }

    @Test
    @DisplayName("CANCELED 뒤 같은 (챌린지, 날짜) 재개설 허용 — 취소는 '없던 일'이라 유니크 계수에서 빠진다")
    void allowsReopenAfterCanceledBetOnSameChallengeAndDate() {
        migrate();
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID challengeId = insertChallenge(jdbcTemplate);

        // 취소 → 재개설 → 또 취소 → 또 재개설: 취소 행은 몇 개든 쌓일 수 있고 활성은 1개만 선다.
        insertBet(jdbcTemplate, challengeId, "CANCELED", BET_DATE);
        insertBet(jdbcTemplate, challengeId, "CANCELED", BET_DATE);
        insertBet(jdbcTemplate, challengeId, "OPEN", BET_DATE);
        assertThatThrownBy(() -> insertBet(jdbcTemplate, challengeId, "OPEN", BET_DATE))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("일 목표분 CHECK — 1440(하루)은 허용, 1441·0 은 거절된다")
    void enforcesDurationGoalBounds() {
        migrate();
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);

        insertDuration(jdbcTemplate, insertChallenge(jdbcTemplate), 1440);
        assertThatThrownBy(() -> insertDuration(jdbcTemplate, insertChallenge(jdbcTemplate), 1441))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertDuration(jdbcTemplate, insertChallenge(jdbcTemplate), 0))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("범위 밖 기존 행(999999·0)이 있어도 V28 은 실패하지 않고 경계값(1440·1)으로 클램프한다")
    void clampsOutOfRangeDurationsBeforeAddingCheck() {
        // V27 까지만 올린 스키마에 상한 없는 시절의 버그 데이터를 재현한다 — plain CHECK 는 기존 행을
        // 즉시 검증하므로, 클램프가 없으면 V28 이 여기서 실패해 배포(부팅)가 막힌다.
        migrate(MigrationVersion.fromVersion("27"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID tooBig = insertChallenge(jdbcTemplate);
        UUID tooSmall = insertChallenge(jdbcTemplate);
        UUID inRange = insertChallenge(jdbcTemplate);
        insertDuration(jdbcTemplate, tooBig, 999_999);
        insertDuration(jdbcTemplate, tooSmall, 0);
        insertDuration(jdbcTemplate, inRange, 60);

        migrate();

        // 초과 목표는 어차피 달성 불가능한 버그 데이터 — 삭제(상세 유실) 대신 경계값으로 보존한다.
        assertThat(durationOf(jdbcTemplate, tooBig)).isEqualTo(1440);
        assertThat(durationOf(jdbcTemplate, tooSmall)).isEqualTo(1);
        assertThat(durationOf(jdbcTemplate, inRange)).isEqualTo(60);
    }

    private Integer durationOf(JdbcTemplate jdbcTemplate, UUID challengeId) {
        return jdbcTemplate.queryForObject(
                "SELECT duration_minutes FROM group_challenge_durations WHERE challenge_id = ?",
                Integer.class, challengeId);
    }

    private boolean constraintExists(JdbcTemplate jdbcTemplate, String name) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ?)", Boolean.class, name));
    }

    private boolean indexExists(JdbcTemplate jdbcTemplate, String name) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = ?)", Boolean.class, name));
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
                        + " VALUES (?, ?, 'DURATION', 'FOCUS', 'INACTIVE', now())",
                id, GROUP_ID);
        return id;
    }

    private void insertBet(JdbcTemplate jdbcTemplate, UUID challengeId, String status, LocalDate betDate) {
        jdbcTemplate.update(
                "INSERT INTO group_challenge_bets"
                        + " (id, group_id, challenge_id, creator_user_id, stake, bet_date, status,"
                        + " created_at, updated_at) VALUES (?, ?, ?, ?, 30, ?, ?, now(), now())",
                UUID.randomUUID(), GROUP_ID, challengeId, USER_ID, Date.valueOf(betDate), status);
    }

    private void insertDuration(JdbcTemplate jdbcTemplate, UUID challengeId, int durationMinutes) {
        jdbcTemplate.update(
                "INSERT INTO group_challenge_durations (challenge_id, duration_minutes) VALUES (?, ?)",
                challengeId, durationMinutes);
    }

    private void migrate() {
        migrate(ERA_END);
    }

    /** 검증 대상은 V28 시점의 역사다 — LATEST 로 올리면 V39(2계층 재편)가 구 스키마를 걷어가 버린다. */
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
