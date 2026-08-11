package com.oneorthree.phone.focus.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V47(유저당 라이브 마커 1개 — 백필 + 부분 유니크 인덱스)의 실 PostgreSQL 마이그레이션 검증 (GROMO-1287).
 *
 * <p>JPA 는 부분 유니크 인덱스를 표현할 수 없어 ci 프로파일(create-drop) 스키마에는 이 인덱스가 없다.
 * 그래서 "마이그레이션이 이걸 만드는가"는 여기서만 확인된다 — 테스트가 인덱스를 손수 만들어 주면
 * 프로덕션 배선의 부재가 가려진다(ShedLockIntegrationTest 전례).
 */
class FocusSessionV47MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final UUID USER_A = UUID.randomUUID();
    private static final UUID USER_B = UUID.randomUUID();

    // 유저 A 의 열린 마커 3개 — 중복 시작·마커 회전 잔재를 재현한다.
    private static final UUID A_OLDEST = UUID.randomUUID();
    private static final UUID A_MIDDLE = UUID.randomUUID();
    private static final UUID A_NEWEST = UUID.randomUUID();
    private static final UUID A_LEGACY_ACTIVE = UUID.randomUUID();   // ended_at 채워진 채 ACTIVE 로 남은 레거시 완료
    private static final UUID B_ONLY = UUID.randomUUID();
    private static final UUID WITHDRAWN_1 = UUID.randomUUID();       // user_id IS NULL (탈퇴)
    private static final UUID WITHDRAWN_2 = UUID.randomUUID();

    private static final Instant T00 = Instant.parse("2026-07-03T00:00:00Z");
    private static final Instant T01 = Instant.parse("2026-07-03T01:00:00Z");
    private static final Instant T20 = Instant.parse("2026-07-03T20:00:00Z");

    private JdbcTemplate jdbc;

    @BeforeEach
    void resetSchema() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("유저당 다중 라이브 마커가 있는 상태에서도 마이그레이션이 통과한다 — 백필이 최신 1건만 남긴다")
    void backfillsDuplicateLiveMarkersSoTheUniqueIndexCanBeCreated() {
        // given: V46 스키마 + 프로덕션에 실제로 있는 오염(유저 A 에 열린 마커 3개)
        migrate("46");
        seedDuplicateLiveMarkers();
        assertThat(openMarkerCount(USER_A)).isEqualTo(3);

        // when: V47 — 백필(①)이 먼저 돌지 않으면 여기서 유니크 위반으로 부팅이 막힌다
        migrate("47");

        // then: 유저 A 의 열린 마커는 가장 최신 1건뿐
        assertThat(openMarkerCount(USER_A)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT id::text FROM focus_sessions WHERE user_id = ? AND ended_at IS NULL",
                String.class, USER_A))
                .isEqualTo(A_NEWEST.toString());

        // 마감된 두 건은 AUTO_CLOSED — 집계 제외 목록(NOT IN (CANCELED, AUTO_CLOSED))에 이미 있고,
        // PATCH 409 가 SESSION_DISCARDED 로 갈려 앱이 POST 로 폴백해 시간·코인을 회수하는 값이다.
        assertThat(statusOf(A_OLDEST)).isEqualTo("AUTO_CLOSED");
        assertThat(statusOf(A_MIDDLE)).isEqualTo("AUTO_CLOSED");
        // ended_at = LEAST(다음 열린 마커 started_at, started_at + 12h)
        assertThat(endedAtOf(A_OLDEST)).isEqualTo(T01);                          // 다음 마커(01:00)가 더 이르다
        assertThat(endedAtOf(A_MIDDLE)).isEqualTo(T01.plusSeconds(12 * 3600));   // 12h 상한이 더 이르다
        // 역전(ended_at < started_at) 없음
        assertThat(endedAtOf(A_OLDEST)).isAfter(T00);
        assertThat(endedAtOf(A_MIDDLE)).isAfter(T01);
    }

    @Test
    @DisplayName("백필은 통계에 반영된 행·다른 유저·탈퇴(user_id NULL) 행을 건드리지 않는다")
    void backfillLeavesCreditedAndUnrelatedRowsAlone() {
        migrate("46");
        seedDuplicateLiveMarkers();

        migrate("47");

        // 레거시 완료(ended_at 채워진 채 ACTIVE) — status 술어였다면 유니크에 계수돼 인덱스 생성이 실패했을 행.
        // 백필은 ended_at IS NULL 만 보므로 상태·종료시각이 그대로다(= 이미 귀속된 통계·코인이 흔들리지 않는다).
        assertThat(statusOf(A_LEGACY_ACTIVE)).isEqualTo("ACTIVE");
        assertThat(endedAtOf(A_LEGACY_ACTIVE)).isEqualTo(T01);

        // 열린 마커가 원래 1개뿐이던 유저는 그대로 라이브
        assertThat(statusOf(B_ONLY)).isEqualTo("ACTIVE");
        assertThat(endedAtOf(B_ONLY)).isNull();

        // 탈퇴로 user_id 가 null 이 된 행은 유니크가 NULL 을 중복으로 보지 않아 손댈 이유가 없다
        assertThat(statusOf(WITHDRAWN_1)).isEqualTo("ACTIVE");
        assertThat(statusOf(WITHDRAWN_2)).isEqualTo("ACTIVE");
        assertThat(endedAtOf(WITHDRAWN_1)).isNull();
        assertThat(endedAtOf(WITHDRAWN_2)).isNull();
    }

    @Test
    @DisplayName("인덱스는 status='ACTIVE' 가 아니라 ended_at IS NULL 을 술어로 만들어진다")
    void createsPartialUniqueIndexOnEndedAtIsNull() {
        migrate("47");

        String definition = jdbc.queryForObject(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'"
                        + " AND tablename = 'focus_sessions' AND indexname = 'uq_focus_sessions_live_marker'",
                String.class);

        assertThat(definition)
                .contains("CREATE UNIQUE INDEX")
                .contains("(user_id)")
                .contains("WHERE (ended_at IS NULL)")
                .doesNotContain("status");
    }

    @Test
    @DisplayName("같은 유저의 두 번째 라이브 마커 INSERT 는 거절된다 — 중복 시작 차단")
    void rejectsSecondLiveMarkerForSameUser() {
        migrate("47");
        insertUser(USER_A);
        insertSession(A_NEWEST, USER_A, T00, null, "ACTIVE");

        assertThatThrownBy(() -> insertSession(UUID.randomUUID(), USER_A, T01, null, "ACTIVE"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_focus_sessions_live_marker");
    }

    @Test
    @DisplayName("마커 회전(close-then-open)은 통과한다 — 이 순서가 뒤집히면 정상 흐름이 500 이 된다")
    void allowsCloseThenOpenMarkerRotation() {
        migrate("47");
        insertUser(USER_A);
        insertSession(A_OLDEST, USER_A, T00, null, "ACTIVE");

        // 서버 startFocusSession 이 하는 순서 그대로: 열린 마커 원자 마감 → 새 마커 INSERT
        assertThatCode(() -> {
            jdbc.update("UPDATE focus_sessions SET status = 'AUTO_CLOSED', ended_at = ?"
                            + " WHERE user_id = ? AND ended_at IS NULL",
                    Timestamp.from(T01), USER_A);
            insertSession(A_NEWEST, USER_A, T01, null, "ACTIVE");
        }).doesNotThrowAnyException();

        assertThat(openMarkerCount(USER_A)).isEqualTo(1);

        // 반대로 마감 없이(= open-then-close) 열면 거절된다 — 인덱스가 실제로 강제하고 있다는 대조군
        assertThatThrownBy(() -> insertSession(UUID.randomUUID(), USER_A, T20, null, "ACTIVE"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("탈퇴(user_id NULL) 행은 여러 개가 미종료로 공존해도 인덱스가 막지 않는다")
    void allowsMultipleOpenRowsWithNullUser() {
        migrate("47");

        assertThatCode(() -> {
            insertSession(WITHDRAWN_1, null, T00, null, "ACTIVE");
            insertSession(WITHDRAWN_2, null, T01, null, "ACTIVE");
        }).doesNotThrowAnyException();
    }

    // ── 시드 ────────────────────────────────────────────────────────────────

    /** 프로덕션 오염 재현: 유저 A 는 열린 마커 3개 + 레거시 완료 1개, 유저 B 는 정상 1개, 탈퇴 행 2개. */
    private void seedDuplicateLiveMarkers() {
        insertUser(USER_A);
        insertUser(USER_B);
        insertSession(A_OLDEST, USER_A, T00, null, "ACTIVE");
        insertSession(A_MIDDLE, USER_A, T01, null, "ACTIVE");
        insertSession(A_NEWEST, USER_A, T20, null, "ACTIVE");
        insertSession(A_LEGACY_ACTIVE, USER_A, T00, T01, "ACTIVE");
        insertSession(B_ONLY, USER_B, T00, null, "ACTIVE");
        insertSession(WITHDRAWN_1, null, T00, null, "ACTIVE");
        insertSession(WITHDRAWN_2, null, T01, null, "ACTIVE");
    }

    private void insertUser(UUID id) {
        jdbc.update("INSERT INTO users (id, is_guest) VALUES (?, false)", id);
    }

    private void insertSession(UUID id, UUID userId, Instant startedAt, Instant endedAt, String status) {
        // 파라미터가 전부 대상 컬럼에 직접 대응하는 VALUES 목록이라 null 도 서버가 컬럼 타입으로 추론한다
        // (표현식 안에 놓였다면 명시 캐스트가 필요하다).
        jdbc.update("INSERT INTO focus_sessions"
                        + " (id, user_id, started_at, ended_at, total_distraction_seconds, status)"
                        + " VALUES (?, ?, ?, ?, 0, ?)",
                id, userId, Timestamp.from(startedAt), endedAt == null ? null : Timestamp.from(endedAt), status);
    }

    // ── 조회 헬퍼 ───────────────────────────────────────────────────────────

    private int openMarkerCount(UUID userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM focus_sessions WHERE user_id = ? AND ended_at IS NULL",
                Integer.class, userId);
        return count == null ? 0 : count;
    }

    private String statusOf(UUID sessionId) {
        return jdbc.queryForObject("SELECT status FROM focus_sessions WHERE id = ?", String.class, sessionId);
    }

    private Instant endedAtOf(UUID sessionId) {
        Timestamp endedAt = jdbc.queryForObject(
                "SELECT ended_at FROM focus_sessions WHERE id = ?", Timestamp.class, sessionId);
        return endedAt == null ? null : endedAt.toInstant();
    }

    private void migrate(String target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(target))
                .load()
                .migrate();
    }
}
