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
import java.time.LocalTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V32 마이그레이션의 실 SQL 검증 — 챌린지 스키마 기반 공사
 * (GROMO-1260 요일 반복 · 1261 started_at/ended_at · 1263 창 시각 time 전환 · 1264 stake 상한 ·
 * 1265 members 잔재 컬럼 제거 · 1266 usage_date NOT NULL · 1267 스크린타임 nullable).
 *
 * <p><b>여기가 이 마이그레이션의 유일한 검증 지점이다.</b> ci 프로파일은 Flyway 를 끄고
 * {@code ddl-auto: create-drop} 으로 스키마를 만들기 때문에, 마이그레이션 SQL 자체(백필 값·데이터 정규화·
 * CHECK)는 애플리케이션 테스트가 한 줄도 밟지 않는다. {@code GroupChallengeV28MigrationTest} 와 같은
 * 방식으로 전용 컨테이너에 Flyway 체인을 실제로 돌린다 — V31 에서 멈춰 레거시 데이터를 심고 V32 로 올린다.
 */
class GroupChallengeV32MigrationTest {

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
    private static final Instant CREATED_AT = Instant.parse("2026-07-15T04:20:00Z");

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        jdbcTemplate.execute("DROP SCHEMA public CASCADE");
        jdbcTemplate.execute("CREATE SCHEMA public");
    }

    // ── GROMO-1260 요일 반복 ──────────────────────────────────────────

    @Test
    @DisplayName("repeat_days — 기존 행은 127(매일)로 백필되고 0·128 은 CHECK 가 막는다")
    void backfillsRepeatDaysToEveryDayAndBoundsIt() {
        migrate(MigrationVersion.fromVersion("31"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID legacy = insertLegacyChallenge(jdbcTemplate);

        migrate();

        // 요일 개념이 없던 시절의 챌린지는 매일 도는 것이 현행 동작 — 127 이 의미 보존이다.
        assertThat(shortOf(jdbcTemplate, "repeat_days", legacy)).isEqualTo((short) 127);

        // 0(요일 미선택)과 128(범위 밖)은 저장 불가 — "언제 도는지"를 반드시 고르게 하는 정책의 방어선.
        assertThatThrownBy(() -> insertChallenge(jdbcTemplate, "DURATION", "SCREEN_TIME", 0))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertChallenge(jdbcTemplate, "DURATION", "SCREEN_TIME", 128))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 경계값은 통과한다: 1(월요일만) · 127(매일).
        insertChallenge(jdbcTemplate, "DURATION", "SCREEN_TIME", 1);
        insertChallenge(jdbcTemplate, "TIME_WINDOW", "SCREEN_TIME", 127);
    }

    @Test
    @DisplayName("repeat_days 에 DEFAULT 가 없다 — 값을 빠뜨린 INSERT 는 조용히 '매일'이 되는 대신 실패한다")
    void hasNoRepeatDaysDefault() {
        migrate();
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);

        assertThatThrownBy(() -> jdbcTemplate.update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, started_at, created_at)"
                        + " VALUES (?, ?, 'DURATION', 'FOCUS', 'ACTIVE', now(), now())",
                UUID.randomUUID(), GROUP_ID))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    // ── GROMO-1261 started_at / ended_at ─────────────────────────────

    @Test
    @DisplayName("started_at 은 created_at 으로 백필되고, 레거시 INACTIVE 행의 ended_at 은 null 로 남는다")
    void backfillsStartedAtFromCreatedAtAndLeavesEndedAtNull() {
        migrate(MigrationVersion.fromVersion("31"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID legacy = insertLegacyChallenge(jdbcTemplate);

        migrate();

        assertThat(instantOf(jdbcTemplate, "started_at", legacy)).isEqualTo(CREATED_AT);
        // 종료 전이 코드가 없던 시절의 INACTIVE 행은 언제 끝났는지 복원할 근거가 없다 —
        // created_at 등으로 꾸며내면 이력이 거짓이 되므로 null 로 둔다.
        assertThat(instantOf(jdbcTemplate, "ended_at", legacy)).isNull();
    }

    @Test
    @DisplayName("status 도메인은 ACTIVE/INACTIVE 그대로다 — 정책의 ENDED 는 이름이 아니라 의미로만 확정했다")
    void keepsInactiveAsTheEndedStatusName() {
        migrate();
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);

        UUID ended = insertChallenge(jdbcTemplate, "DURATION", "FOCUS", 127);
        jdbcTemplate.update("UPDATE group_challenges SET status = 'INACTIVE', ended_at = now() WHERE id = ?", ended);
        assertThat(instantOf(jdbcTemplate, "ended_at", ended)).isNotNull();

        // 'ENDED' 를 값으로 쓰면 V2 CHECK 가 막는다 — 이름 변경은 이 마이그레이션의 범위 밖이다.
        assertThatThrownBy(() -> jdbcTemplate.update(
                "UPDATE group_challenges SET status = 'ENDED' WHERE id = ?", ended))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    // ── GROMO-1263 창 시각 time 전환 ──────────────────────────────────

    @Test
    @DisplayName("창 시각 전환은 KST 벽시계를 보존한다 — UTC 로 읽으면 정확히 9시간 어긋난다")
    void convertsWindowColumnsToKstWallClockTime() {
        migrate(MigrationVersion.fromVersion("31"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID challengeId = insertLegacyChallenge(jdbcTemplate);
        // 저장 규약: Instant 지만 의미는 KST 벽시계 시각뿐. 00:00Z = 09:00 KST, 03:00Z = 12:00 KST.
        jdbcTemplate.update(
                "INSERT INTO group_challenge_windows"
                        + " (challenge_id, window_start_at, window_end_at, duration_minutes)"
                        + " VALUES (?, ?, ?, 90)",
                challengeId,
                Timestamp.from(Instant.parse("1970-01-01T00:00:00Z")),
                Timestamp.from(Instant.parse("1970-01-01T03:00:00Z")));

        migrate();

        // 9시간 함정: USING 절이 'Asia/Seoul' 이 아니면 여기서 00:00/03:00 이 나온다.
        assertThat(timeOf(jdbcTemplate, "window_start", challengeId)).isEqualTo(LocalTime.of(9, 0));
        assertThat(timeOf(jdbcTemplate, "window_end", challengeId)).isEqualTo(LocalTime.of(12, 0));
        assertThat(columnType(jdbcTemplate, "group_challenge_windows", "window_start")).isEqualTo("time without time zone");
        // _at 접미사 컬럼은 사라졌다(시점이 아니라 시각이다).
        assertThat(columnExists(jdbcTemplate, "group_challenge_windows", "window_start_at")).isFalse();
        assertThat(columnExists(jdbcTemplate, "group_challenge_windows", "window_end_at")).isFalse();
    }

    @Test
    @DisplayName("레거시 자정 걸침 창(22:00~01:00)은 23:59 로 잘려 살아남고 목표분도 창 길이로 함께 클램프된다")
    void clampsMidnightCrossingWindowAndItsGoal() {
        migrate(MigrationVersion.fromVersion("31"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID challengeId = insertLegacyChallenge(jdbcTemplate);
        // 13:00Z = 22:00 KST(당일), 16:00Z = 01:00 KST(익일) — 걸침이 허용이던 시절의 180분 창.
        jdbcTemplate.update(
                "INSERT INTO group_challenge_windows"
                        + " (challenge_id, window_start_at, window_end_at, duration_minutes)"
                        + " VALUES (?, ?, ?, 120)",
                challengeId,
                Timestamp.from(Instant.parse("1970-01-01T13:00:00Z")),
                Timestamp.from(Instant.parse("1970-01-01T16:00:00Z")));

        migrate();

        // 삭제가 아니라 클램프다 — 창 행은 챌린지의 1:1 상세(CTI)라 지우면 반쪽 챌린지가 남는다.
        assertThat(timeOf(jdbcTemplate, "window_start", challengeId)).isEqualTo(LocalTime.of(22, 0));
        assertThat(timeOf(jdbcTemplate, "window_end", challengeId)).isEqualTo(LocalTime.of(23, 59));
        // 창이 180분 → 119분으로 줄었으니 목표 120분도 따라 줄어야 한다. 안 그러면
        // "창 119분인데 목표 120분" 이라는 달성 불가 챌린지가 남는다(정책 §A6-2).
        assertThat(goalOf(jdbcTemplate, challengeId)).isEqualTo(119);
    }

    @Test
    @DisplayName("전환 후 CHECK (window_start < window_end) 가 서서 자정 걸침·0길이 INSERT 를 막는다")
    void rejectsMidnightCrossingAndZeroLengthWindowsAfterMigration() {
        migrate();
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);

        // 자정 걸침(22:00~01:00) — 요일이 회차를 가르는 축이라 회차가 요일 경계를 넘으면 안 된다(정책 §A6-1).
        assertThatThrownBy(() -> insertWindow(jdbcTemplate, LocalTime.of(22, 0), LocalTime.of(1, 0), 60))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 0길이(시작 == 종료)도 같은 조건 하나로 함께 닫힌다.
        assertThatThrownBy(() -> insertWindow(jdbcTemplate, LocalTime.of(9, 0), LocalTime.of(9, 0), 1))
                .isInstanceOf(DataIntegrityViolationException.class);

        // 심야 챌린지의 대체 경로 — 자정 앞에서 끊으면 통과한다.
        insertWindow(jdbcTemplate, LocalTime.of(22, 0), LocalTime.of(23, 59), 60);
    }

    // ── GROMO-1264 stake 상한 ─────────────────────────────────────────

    @Test
    @DisplayName("상한 밖 기존 stake(5000·0)는 경계값으로 클램프되고 이후 1~1000 만 통과한다")
    void clampsOutOfRangeStakesBeforeAddingCheck() {
        // 상한이 서비스 상수로만 있던 시절의 데이터를 재현한다 — plain CHECK 는 기존 행을 즉시 검증하므로
        // 클램프가 없으면 V32 가 여기서 실패해 배포(부팅)가 막힌다.
        migrate(MigrationVersion.fromVersion("31"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID challengeId = insertLegacyChallenge(jdbcTemplate);
        UUID tooBig = insertBet(jdbcTemplate, challengeId, 5_000, LocalDate.of(2026, 8, 1));
        UUID inRange = insertBet(jdbcTemplate, challengeId, 30, LocalDate.of(2026, 8, 2));

        migrate();

        // 내기 행은 코인이 오간 이력이라 삭제가 아니라 클램프다(정산 근거를 지우지 않는다).
        assertThat(stakeOf(jdbcTemplate, tooBig)).isEqualTo(1_000);
        assertThat(stakeOf(jdbcTemplate, inRange)).isEqualTo(30);

        assertThatThrownBy(() -> insertBet(jdbcTemplate, challengeId, 1_001, LocalDate.of(2026, 8, 3)))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertBet(jdbcTemplate, challengeId, 0, LocalDate.of(2026, 8, 4)))
                .isInstanceOf(DataIntegrityViolationException.class);
        insertBet(jdbcTemplate, challengeId, 1_000, LocalDate.of(2026, 8, 5));
        insertBet(jdbcTemplate, challengeId, 1, LocalDate.of(2026, 8, 6));
    }

    @Test
    @DisplayName("프로덕션식 — stake CHECK 이름이 자동명과 달라도 드롭·교체되고 status CHECK 는 오폭하지 않는다")
    void replacesStakeCheckNameAgnostically() {
        migrate(MigrationVersion.fromVersion("31"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID challengeId = insertLegacyChallenge(jdbcTemplate);
        // 자동 생성명(group_challenge_bets_stake_check)이 아닌 환경 재현 — DO $$ 가 이름이 아니라
        // stake 컬럼 참조(conkey)로 드롭 대상을 찾는지 검증한다(V20 패턴 재사용).
        jdbcTemplate.execute("ALTER TABLE group_challenge_bets"
                + " RENAME CONSTRAINT group_challenge_bets_stake_check TO ck_legacy_renamed_stake");

        migrate();

        assertThat(constraintExists(jdbcTemplate, "ck_legacy_renamed_stake")).isFalse();
        assertThat(constraintExists(jdbcTemplate, "group_challenge_bets_stake_check")).isTrue();
        assertThatThrownBy(() -> insertBet(jdbcTemplate, challengeId, 1_001, LocalDate.of(2026, 8, 7)))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 같은 테이블의 status CHECK 는 살아 있어야 한다.
        assertThatThrownBy(() -> jdbcTemplate.update(
                "INSERT INTO group_challenge_bets"
                        + " (id, group_id, challenge_id, creator_user_id, stake, bet_date, status,"
                        + " created_at, updated_at) VALUES (?, ?, ?, ?, 30, ?, 'BOGUS', now(), now())",
                UUID.randomUUID(), GROUP_ID, challengeId, USER_ID, Date.valueOf(LocalDate.of(2026, 8, 8))))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    // ── GROMO-1265 / 1266 members 정리 ────────────────────────────────

    @Test
    @DisplayName("members 잔재 컬럼 3종이 사라지고, usage_date NULL 레거시 행은 삭제된 뒤 NOT NULL 이 선다")
    void dropsVestigialColumnsAndTightensUsageDate() {
        migrate(MigrationVersion.fromVersion("31"));
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);
        UUID challengeId = insertLegacyChallenge(jdbcTemplate);
        // 레거시 유령 행: usage_date 가 없어 어느 회차의 값인지 복원 불가 — 백필 대상이 아니라 삭제 대상이다.
        UUID orphan = insertLegacyMember(jdbcTemplate, challengeId, null);
        UUID kept = insertLegacyMember(jdbcTemplate, challengeId, LocalDate.of(2026, 8, 1));

        migrate();

        assertThat(memberExists(jdbcTemplate, orphan)).isFalse();
        assertThat(memberExists(jdbcTemplate, kept)).isTrue();

        assertThat(columnExists(jdbcTemplate, "group_challenge_members", "is_achieved")).isFalse();
        assertThat(columnExists(jdbcTemplate, "group_challenge_members", "achieved_at")).isFalse();
        assertThat(columnExists(jdbcTemplate, "group_challenge_members", "deleted_at")).isFalse();

        // NOT NULL 이 실제로 섰는지 — 이게 없으면 (챌린지, 유저, 날짜) 유니크가 NULL 끼리 안 걸린다.
        assertThatThrownBy(() -> insertMember(jdbcTemplate, challengeId, null))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 같은 (챌린지, 유저, 날짜) 중복은 유니크가 막고, 다른 날짜는 허용된다.
        assertThatThrownBy(() -> insertMember(jdbcTemplate, challengeId, LocalDate.of(2026, 8, 1)))
                .isInstanceOf(DataIntegrityViolationException.class);
        insertMember(jdbcTemplate, challengeId, LocalDate.of(2026, 8, 2));
    }

    // ── GROMO-1267 스크린타임 미집계 ──────────────────────────────────

    @Test
    @DisplayName("total_screen_time_minutes 가 nullable 이 돼 0분과 미집계가 구분된다")
    void allowsNullScreenTimeMinutes() {
        migrate();
        JdbcTemplate jdbcTemplate = jdbcTemplate();
        insertGroupAndUser(jdbcTemplate);

        insertScreenTimeStat(jdbcTemplate, LocalDate.of(2026, 8, 1), null);
        insertScreenTimeStat(jdbcTemplate, LocalDate.of(2026, 8, 2), 0);

        assertThat(screenMinutesOn(jdbcTemplate, LocalDate.of(2026, 8, 1))).isNull();
        assertThat(screenMinutesOn(jdbcTemplate, LocalDate.of(2026, 8, 2))).isZero();
    }

    // ── 헬퍼 ─────────────────────────────────────────────────────────

    private Short shortOf(JdbcTemplate jdbcTemplate, String column, UUID challengeId) {
        return jdbcTemplate.queryForObject(
                "SELECT " + column + " FROM group_challenges WHERE id = ?", Short.class, challengeId);
    }

    private Instant instantOf(JdbcTemplate jdbcTemplate, String column, UUID challengeId) {
        Timestamp value = jdbcTemplate.queryForObject(
                "SELECT " + column + " FROM group_challenges WHERE id = ?", Timestamp.class, challengeId);
        return value == null ? null : value.toInstant();
    }

    private LocalTime timeOf(JdbcTemplate jdbcTemplate, String column, UUID challengeId) {
        return jdbcTemplate.queryForObject(
                "SELECT " + column + " FROM group_challenge_windows WHERE challenge_id = ?",
                LocalTime.class, challengeId);
    }

    private Integer goalOf(JdbcTemplate jdbcTemplate, UUID challengeId) {
        return jdbcTemplate.queryForObject(
                "SELECT duration_minutes FROM group_challenge_windows WHERE challenge_id = ?",
                Integer.class, challengeId);
    }

    /** V32 이후 스키마 — 창 시각은 time 이다. 상세는 챌린지와 1:1(PK)이라 매번 새 챌린지를 만든다. */
    private void insertWindow(JdbcTemplate jdbcTemplate, LocalTime start, LocalTime end, int goal) {
        UUID challengeId = insertChallenge(jdbcTemplate, "TIME_WINDOW", "FOCUS", 127);
        jdbcTemplate.update(
                "INSERT INTO group_challenge_windows"
                        + " (challenge_id, window_start, window_end, duration_minutes) VALUES (?, ?, ?, ?)",
                challengeId, start, end, goal);
    }

    private Integer stakeOf(JdbcTemplate jdbcTemplate, UUID betId) {
        return jdbcTemplate.queryForObject(
                "SELECT stake FROM group_challenge_bets WHERE id = ?", Integer.class, betId);
    }

    private Integer screenMinutesOn(JdbcTemplate jdbcTemplate, LocalDate date) {
        return jdbcTemplate.queryForObject(
                "SELECT total_screen_time_minutes FROM daily_screen_time_stats WHERE user_id = ? AND date = ?",
                Integer.class, USER_ID, Date.valueOf(date));
    }

    private boolean memberExists(JdbcTemplate jdbcTemplate, UUID id) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM group_challenge_members WHERE id = ?)", Boolean.class, id));
    }

    private boolean columnExists(JdbcTemplate jdbcTemplate, String table, String column) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns"
                        + " WHERE table_schema = 'public' AND table_name = ? AND column_name = ?)",
                Boolean.class, table, column));
    }

    private String columnType(JdbcTemplate jdbcTemplate, String table, String column) {
        return jdbcTemplate.queryForObject(
                "SELECT data_type FROM information_schema.columns"
                        + " WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
                String.class, table, column);
    }

    private boolean constraintExists(JdbcTemplate jdbcTemplate, String name) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ?)", Boolean.class, name));
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

    /** V31 시점(= V32 이전) 스키마 — repeat_days·started_at 컬럼이 아직 없다. */
    private UUID insertLegacyChallenge(JdbcTemplate jdbcTemplate) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO group_challenges (id, group_id, type, category, status, created_at)"
                        + " VALUES (?, ?, 'TIME_WINDOW', 'FOCUS', 'INACTIVE', ?)",
                id, GROUP_ID, Timestamp.from(CREATED_AT));
        return id;
    }

    /** V32 이후 스키마 — repeat_days 를 직접 지정해 CHECK 경계를 찌른다. */
    private UUID insertChallenge(JdbcTemplate jdbcTemplate, String type, String category, int repeatDays) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO group_challenges"
                        + " (id, group_id, type, category, status, repeat_days, started_at, created_at)"
                        + " VALUES (?, ?, ?, ?, 'INACTIVE', ?, now(), now())",
                id, GROUP_ID, type, category, repeatDays);
        return id;
    }

    private UUID insertBet(JdbcTemplate jdbcTemplate, UUID challengeId, int stake, LocalDate betDate) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO group_challenge_bets"
                        + " (id, group_id, challenge_id, creator_user_id, stake, bet_date, status,"
                        + " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', now(), now())",
                id, GROUP_ID, challengeId, USER_ID, stake, Date.valueOf(betDate));
        return id;
    }

    /** V31 시점 스키마 — is_achieved 가 아직 살아 있고 NOT NULL 이다. */
    private UUID insertLegacyMember(JdbcTemplate jdbcTemplate, UUID challengeId, LocalDate usageDate) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO group_challenge_members"
                        + " (id, created_at, is_achieved, progress_minutes, group_challenge_id, user_id, usage_date)"
                        + " VALUES (?, now(), false, 0, ?, ?, ?)",
                id, challengeId, USER_ID, usageDate == null ? null : Date.valueOf(usageDate));
        return id;
    }

    private void insertMember(JdbcTemplate jdbcTemplate, UUID challengeId, LocalDate usageDate) {
        jdbcTemplate.update(
                "INSERT INTO group_challenge_members"
                        + " (id, created_at, progress_minutes, group_challenge_id, user_id, usage_date)"
                        + " VALUES (?, now(), 0, ?, ?, ?)",
                UUID.randomUUID(), challengeId, USER_ID, usageDate == null ? null : Date.valueOf(usageDate));
    }

    private void insertScreenTimeStat(JdbcTemplate jdbcTemplate, LocalDate date, Integer minutes) {
        jdbcTemplate.update(
                "INSERT INTO daily_screen_time_stats"
                        + " (id, user_id, date, total_screen_time_minutes, is_screen_time_goal_achieved,"
                        + " is_screen_time_finalized, created_at) VALUES (?, ?, ?, ?, false, false, now())",
                UUID.randomUUID(), USER_ID, Date.valueOf(date), minutes);
    }

    private void migrate() {
        migrate(MigrationVersion.LATEST);
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
