package com.oneorthree.phone.focus.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * V47(유저당 라이브 마커 1개 — <b>백필</b>)의 실 PostgreSQL 마이그레이션 검증 (GROMO-1287).
 *
 * <p>ci 프로파일은 {@code create-drop} + Flyway 비활성이라 마이그레이션 SQL 이 한 번도 실행되지 않는다.
 * 백필이 실제로 무엇을 하는지는 여기서만 확인된다 — 테스트가 결과 상태를 손수 만들어 주면
 * 프로덕션 배선의 부재가 가려진다(ShedLockIntegrationTest 전례).
 *
 * <p><b>부분 유니크 인덱스는 V47 에 없다(후속 티켓)</b>. prod 롤백이 Flyway 를 유지한 채 이미지만
 * 되돌리므로, close-then-open 이 안착하기 전에 인덱스를 넣으면 롤백된 구버전 서버가 마커 회전마다
 * 유니크 위반 500 을 낸다. 그래서 <b>인덱스가 없다는 것</b>도 여기서 못 박는다 — 누군가 되살리면
 * 이 테스트가 먼저 깨져 롤백 위험을 다시 검토하게 된다.
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
    @DisplayName("유저당 다중 라이브 마커를 최신 1건만 남기고 정리한다 — 정산 가드·isFocusing 오염 해소")
    void backfillLeavesOnlyTheNewestLiveMarkerPerUser() {
        // given: V46 스키마 + 프로덕션에 실제로 있는 오염(유저 A 에 열린 마커 3개)
        migrate("46");
        seedDuplicateLiveMarkers();
        assertThat(openMarkerCount(USER_A)).isEqualTo(3);

        // when: V47 백필
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

        // 정산 대기 가드(GROMO-1287)와의 관계: 백필의 ended_at 은 '지금'이 아니라 과거값이라
        // 가드의 '방금 닫힌 마커' 유예창(5분)에 걸리지 않는다 → 배포 직후 창형 FOCUS 정산이 멈추지 않는다.
        assertThat(endedAtOf(A_OLDEST)).isBefore(Instant.now().minus(Duration.ofMinutes(5)));
        assertThat(endedAtOf(A_MIDDLE)).isBefore(Instant.now().minus(Duration.ofMinutes(5)));
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
    @DisplayName("V47 은 부분 유니크 인덱스를 만들지 않는다 — prod 롤백(이미지만 교체) 안전을 위해 후속 배포로 분리")
    void doesNotCreateUniqueIndexYetSoOldImagesCanRollBack() {
        migrate("47");

        // 인덱스가 생겼다면 이 단언이 먼저 깨진다 — 되살리기 전에 롤백 위험(구버전 startFocusSession 이
        // 열린 마커를 닫지 않고 INSERT → 마커 회전마다 유니크 위반 500)을 다시 검토하라는 신호다.
        assertThat(jdbc.queryForList(
                "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
                        + " AND tablename = 'focus_sessions'",
                String.class))
                .doesNotContain("uq_focus_sessions_live_marker");

        // 그래서 지금은 DB 가 두 번째 라이브 마커를 막지 않는다 — 불변식은 서비스 레이어가 지킨다
        // (FocusService.startFocusSession: users 행 배타 락 + close-then-open + startedAt 단조성).
        insertUser(USER_A);
        insertSession(A_OLDEST, USER_A, T00, null, "ACTIVE");
        assertThatCode(() -> insertSession(A_NEWEST, USER_A, T01, null, "ACTIVE"))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("마커 회전(close-then-open) SQL 순서는 백필 이후에도 그대로 성립한다")
    void closeThenOpenRotationLeavesExactlyOneLiveMarker() {
        migrate("47");
        insertUser(USER_A);
        insertSession(A_OLDEST, USER_A, T00, null, "ACTIVE");

        // 서버 startFocusSession 이 하는 순서 그대로: 열린 마커 원자 마감 → 새 마커 INSERT
        jdbc.update("UPDATE focus_sessions SET status = 'AUTO_CLOSED', ended_at = ?"
                        + " WHERE user_id = ? AND ended_at IS NULL",
                Timestamp.from(T01), USER_A);
        insertSession(A_NEWEST, USER_A, T01, null, "ACTIVE");

        assertThat(openMarkerCount(USER_A)).isEqualTo(1);
        assertThat(statusOf(A_OLDEST)).isEqualTo("AUTO_CLOSED");
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
