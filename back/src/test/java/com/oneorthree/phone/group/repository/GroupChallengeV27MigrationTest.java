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
 * V27 마이그레이션의 실 SQL 검증 — 내기 (challenge_id, bet_date) 부분 유니크(취소 제외, GROMO-1201)와
 * 일 목표분 상한 CHECK(GROMO-1205).
 *
 * <p><b>여기가 이 제약의 유일한 DB 검증 지점이다.</b> JPA 는 부분 유니크 인덱스를 표현할 수 없어
 * 엔티티의 {@code @UniqueConstraint} 를 제거했고, ci 프로파일(create-drop)로 만든 스키마에는 이
 * 인덱스가 아예 없다 — 그래서 {@code GroupChallengeV20MigrationTest} 와 같은 방식으로 전용
 * 컨테이너에 Flyway 체인을 실제로 돌려 검증한다.
 */
class GroupChallengeV27MigrationTest {

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
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(MigrationVersion.LATEST)
                .load()
                .migrate();
    }

    private JdbcTemplate jdbcTemplate() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}
