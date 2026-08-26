package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V35(창 시각 time 전환 + 자정 걸침 금지) 실 SQL 검증 — GROMO-1406 · N25 · §A6-1.
 *
 * <p>보는 것: ① KST 벽시계 추출 백필 — UTC 저장 행(+00)도 EPOCH 앵커 행(+09)도 같은 KST 시각으로
 * 수렴한다(UTC 로 읽으면 9시간 어긋난다 — GROMO-1100 함정), ② 컬럼명 window_start/window_end 전환,
 * ③ CHECK (window_start &lt; window_end) — 역전·0길이 거부, ④ 걸침 시절의 start ≥ end 행이 남아
 * 있으면 사전 검사가 명시적 메시지로 마이그레이션을 중단한다. 검증 방식은
 * {@link GroupMemberV31MigrationTest} 선례(전용 컨테이너 + 실 Flyway 체인)를 따른다.
 */
class GroupChallengeV35MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID GROUP_ID = UUID.randomUUID();
    private static final UUID UTC_ANCHORED_ID = UUID.randomUUID();
    private static final UUID EPOCH_ANCHORED_ID = UUID.randomUUID();

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("백필은 KST 벽시계 추출이다 — UTC 저장 행(00:00Z)이 09:00 로, EPOCH 앵커 행(+09)은 그대로")
    void backfillsKstWallClockFromTimestamptz() {
        givenV34StateWithWindows();

        migrate(MigrationVersion.fromVersion("35"));

        // 2026-08-05T00:00:00Z = KST 09:00 — UTC 시각(00:00)으로 읽으면 정확히 9시간 어긋난다.
        assertThat(windowStartOf(UTC_ANCHORED_ID)).isEqualTo("09:00:00");
        assertThat(windowEndOf(UTC_ANCHORED_ID)).isEqualTo("12:00:00");
        // GROMO-1225 이후의 EPOCH 앵커(+09 표기) 행도 같은 규칙으로 벽시계만 남는다.
        assertThat(windowStartOf(EPOCH_ANCHORED_ID)).isEqualTo("22:00:00");
        assertThat(windowEndOf(EPOCH_ANCHORED_ID)).isEqualTo("23:59:00");
    }

    @Test
    @DisplayName("CHECK (window_start < window_end) — 역전(자정 걸침 꼴)과 0길이 삽입이 거부된다")
    void enforcesStartBeforeEndCheck() {
        givenV34StateWithWindows();
        migrate(MigrationVersion.fromVersion("35"));

        UUID crossing = insertChallenge();
        assertThatThrownBy(() -> insertWindowTime(crossing, "22:00:00", "01:00:00"))
                .isInstanceOf(DataIntegrityViolationException.class);
        UUID zeroLength = insertChallenge();
        assertThatThrownBy(() -> insertWindowTime(zeroLength, "09:00:00", "09:00:00"))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 경계 안 값은 통과 — CHECK 가 정상 창까지 막지 않는다.
        insertWindowTime(insertChallenge(), "22:00:00", "23:59:00");
    }

    @Test
    @DisplayName("걸침 시절의 start >= end 행이 남아 있으면 V35 가 명시적 메시지로 중단된다 (배포 전 정리 강제)")
    void abortsWhenMidnightCrossingRowsRemain() {
        migrate(MigrationVersion.fromVersion("34"));
        insertGroup();
        UUID crossing = insertChallenge();
        // 걸침 허용 시절의 저장 형태 — KST 벽시계 기준 22:00 시작, 01:00 종료.
        jdbcTemplate().update(
                "INSERT INTO group_challenge_windows (challenge_id, window_start_at, window_end_at)"
                        + " VALUES (?, timestamptz '1970-01-01 22:00:00+09', timestamptz '1970-01-01 01:00:00+09')",
                crossing);

        assertThatThrownBy(() -> migrate(MigrationVersion.fromVersion("35")))
                .isInstanceOf(FlywayException.class)
                .hasMessageContaining("V35 중단");
    }

    /** V34 까지 올린 스키마에 UTC 표기·EPOCH 앵커 두 가지 저장 형태의 창을 심는다. */
    private void givenV34StateWithWindows() {
        migrate(MigrationVersion.fromVersion("34"));
        insertGroup();
        insertWindowLegacy(UTC_ANCHORED_ID, "FOCUS", "2026-08-05 00:00:00+00", "2026-08-05 03:00:00+00");
        insertWindowLegacy(EPOCH_ANCHORED_ID, "SCREEN_TIME", "1970-01-01 22:00:00+09", "1970-01-01 23:59:00+09");
    }

    private void insertGroup() {
        jdbcTemplate().update(
                "INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name, status)"
                        + " VALUES (?, false, 'OWNER_ONLY', 10, '창전환검증방', 'ACTIVE')",
                GROUP_ID);
    }

    /**
     * V34 스키마의 챌린지 삽입 — repeat_days·started_at NOT NULL. status 는 ENDED 로 심는다:
     * V20 부분 유니크(WHERE status='ACTIVE')가 V36 전까지 살아 있어 ACTIVE 를 여럿 못 심고,
     * 이 테스트의 관심(창 시각 CHECK)은 챌린지 상태와 무관하다.
     */
    private UUID insertChallenge() {
        UUID id = UUID.randomUUID();
        jdbcTemplate().update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at,"
                        + " repeat_days, started_at)"
                        + " VALUES (?, ?, 'TIME_WINDOW', 'FOCUS', 'ENDED', now(), 127, now())",
                id, GROUP_ID);
        return id;
    }

    /**
     * V34 스키마(전환 전 timestamptz 컬럼)에 챌린지 + 창 상세를 함께 심는다.
     * V20 부분 유니크(활성 카테고리×타입 1개)가 V36 전까지 살아 있어 카테고리를 갈라 심는다.
     */
    private void insertWindowLegacy(UUID challengeId, String category, String startAt, String endAt) {
        jdbcTemplate().update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at,"
                        + " repeat_days, started_at)"
                        + " VALUES (?, ?, 'TIME_WINDOW', ?, 'ACTIVE', now(), 127, now())",
                challengeId, GROUP_ID, category);
        jdbcTemplate().update(
                "INSERT INTO group_challenge_windows (challenge_id, window_start_at, window_end_at)"
                        + " VALUES (?, ?::timestamptz, ?::timestamptz)",
                challengeId, startAt, endAt);
    }

    private void insertWindowTime(UUID challengeId, String start, String end) {
        jdbcTemplate().update(
                "INSERT INTO group_challenge_windows (challenge_id, window_start, window_end)"
                        + " VALUES (?, ?::time, ?::time)",
                challengeId, start, end);
    }

    private String windowStartOf(UUID challengeId) {
        return jdbcTemplate().queryForObject(
                "SELECT window_start::text FROM group_challenge_windows WHERE challenge_id = ?",
                String.class, challengeId);
    }

    private String windowEndOf(UUID challengeId) {
        return jdbcTemplate().queryForObject(
                "SELECT window_end::text FROM group_challenge_windows WHERE challenge_id = ?",
                String.class, challengeId);
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
