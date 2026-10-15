package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V39(내기 2계층 재편 + 미션 스냅샷, GROMO-1262·1263)의 실 SQL 검증.
 *
 * <p>보는 것: ① 비취소 내기 행이 설정(챌린지 1:1) + 회차(id 재사용)로 분해된다 — 참가 행의
 * 축 값(bet_id → session_id)이 보존된다, ② 회차에 미션 스냅샷(카테고리·방식·목표분·창 시각)이
 * 박제된다 — 창 시각은 KST 벽시계 추출(GROMO-1100 함정), ③ CANCELED 내기는 회차·참가 행 없이
 * 정리되고 취소 이력뿐인 챌린지는 설정도 안 생긴다, ④ 새 유니크(챌린지 1설정 · 하루 1회차)가
 * DB 에 실재한다. 검증 방식은 {@link GroupMemberV31MigrationTest} 선례 — 전용 컨테이너에 Flyway
 * 체인을 실제로 돌린다.
 *
 * <p><b>선행 배치(B1·B2, V34~V38) 겸용</b>: 시드 INSERT 는 information_schema 로 컬럼 존재를
 * 확인해 신·구 스키마 양쪽에서 유효하도록 구성한다(V39 자체가 창 스키마 겸용으로 작성됐다).
 */
class GroupBetV39MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다(V28 테스트 주석). */
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final LocalDate TODAY = LocalDate.of(2026, 8, 10);
    private static final LocalDate YESTERDAY = TODAY.minusDays(1);

    private JdbcTemplate jdbc;

    @BeforeEach
    void resetSchema() {
        jdbc = jdbcTemplate();
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    // ── 시나리오 ────────────────────────────────────────────────────────

    @Test
    @DisplayName("비취소 내기 행 → 설정 1행(최신 stake 승계) + 날짜별 회차(id 재사용)로 분해되고, 참가 축 값이 보존된다")
    void decomposesBetsIntoConfigAndSessions() {
        migrate("38");
        UUID userId = insertUser("재영");
        UUID groupId = insertGroup("스터디");
        UUID challengeId = insertChallenge(groupId, "FOCUS", "DURATION");
        insertDuration(challengeId, 120);
        // 어제 정산(구 stake 30) + 오늘 OPEN(새 stake 50) — 설정 stake 는 최신 행(50)을 승계한다.
        UUID settledBetId = insertBet(groupId, challengeId, userId, 30, YESTERDAY, "SETTLED", 120);
        UUID openBetId = insertBet(groupId, challengeId, userId, 50, TODAY, "OPEN", null);
        UUID settledJoinId = insertParticipant(settledBetId, userId);
        UUID openJoinId = insertParticipant(openBetId, userId);

        migrate("39");

        // 설정 — 챌린지당 1행, 최신 stake, enabled=true.
        Map<String, Object> config = jdbc.queryForMap(
                "SELECT id, stake, enabled FROM group_challenge_bets WHERE challenge_id = ?", challengeId);
        assertThat(config.get("stake")).isEqualTo(50);
        assertThat(config.get("enabled")).isEqualTo(true);
        UUID configId = (UUID) config.get("id");

        // 회차 — 구 내기 행 id 를 재사용하고 상태·날짜·stake 를 보존한다.
        Map<String, Object> settledSession = sessionOf(settledBetId);
        assertThat(settledSession.get("bet_id")).isEqualTo(configId);
        assertThat(settledSession.get("status")).isEqualTo("SETTLED");
        assertThat(settledSession.get("stake")).isEqualTo(30);
        assertThat(((java.sql.Date) settledSession.get("session_date")).toLocalDate())
                .isEqualTo(YESTERDAY);
        Map<String, Object> openSession = sessionOf(openBetId);
        assertThat(openSession.get("status")).isEqualTo("OPEN");
        assertThat(openSession.get("stake")).isEqualTo(50);

        // 참가 축 — bet_id 값이 그대로 session_id 가 된다(원장 멱등키·알림 dedup 의 대상 id 불변).
        assertThat(jdbc.queryForObject(
                "SELECT session_id FROM group_challenge_bet_participants WHERE id = ?",
                UUID.class, settledJoinId)).isEqualTo(settledBetId);
        assertThat(jdbc.queryForObject(
                "SELECT session_id FROM group_challenge_bet_participants WHERE id = ?",
                UUID.class, openJoinId)).isEqualTo(openBetId);
    }

    @Test
    @DisplayName("미션 스냅샷 박제 — 하루형은 CTI 목표·자정 경계, 창형은 KST 벽시계 창 시각과 창 경계가 박제된다")
    void snapshotsMissionOntoSessions() {
        migrate("38");
        UUID userId = insertUser("재영");
        UUID groupId = insertGroup("스터디");
        // 하루형 — goal_minutes(V29 스냅샷) 없는 OPEN 행은 CTI 목표(120)로 채운다.
        UUID durationChallengeId = insertChallenge(groupId, "FOCUS", "DURATION");
        insertDuration(durationChallengeId, 120);
        UUID durationBetId = insertBet(groupId, durationChallengeId, userId, 30, TODAY, "OPEN", null);
        // 창형 09:00~12:00 KST — 구 스키마면 timestamptz 에서 KST 로 추출돼야 한다(UTC 로 읽으면 9시간 어긋난다).
        UUID windowChallengeId = insertChallenge(groupId, "SCREEN_TIME", "TIME_WINDOW");
        insertWindow(windowChallengeId, "09:00", "12:00", 90);
        UUID windowBetId = insertBet(groupId, windowChallengeId, userId, 30, TODAY, "OPEN", null);

        migrate("39");

        Map<String, Object> durationSession = sessionOf(durationBetId);
        assertThat(durationSession.get("mission_category")).isEqualTo("FOCUS");
        assertThat(durationSession.get("mission_type")).isEqualTo("DURATION");
        assertThat(durationSession.get("goal_minutes")).isEqualTo(120);
        assertThat(durationSession.get("window_start")).isNull();
        // 하루형 경계 — 회차일 00:00 ~ 익일 00:00 (KST).
        assertThat(instantOf(durationSession, "starts_at"))
                .isEqualTo(OffsetDateTime.parse("2026-08-10T00:00:00+09:00").toInstant());
        assertThat(instantOf(durationSession, "closes_at"))
                .isEqualTo(OffsetDateTime.parse("2026-08-11T00:00:00+09:00").toInstant());
        assertThat(instantOf(durationSession, "join_closes_at"))
                .isEqualTo(instantOf(durationSession, "closes_at"));
        // 하루형 SCREEN_TIME 아님 → FOCUS 그레이스 +1h.
        assertThat(instantOf(durationSession, "settle_after"))
                .isEqualTo(OffsetDateTime.parse("2026-08-11T01:00:00+09:00").toInstant());

        Map<String, Object> windowSession = sessionOf(windowBetId);
        assertThat(windowSession.get("mission_category")).isEqualTo("SCREEN_TIME");
        assertThat(windowSession.get("mission_type")).isEqualTo("TIME_WINDOW");
        assertThat(windowSession.get("goal_minutes")).isEqualTo(90);
        assertThat(String.valueOf(windowSession.get("window_start"))).startsWith("09:00");
        assertThat(String.valueOf(windowSession.get("window_end"))).startsWith("12:00");
        // 창형 경계 — 창 시작(참가 마감) ~ 창 종료, 정산 그레이스 +30분.
        assertThat(instantOf(windowSession, "starts_at"))
                .isEqualTo(OffsetDateTime.parse("2026-08-10T09:00:00+09:00").toInstant());
        assertThat(instantOf(windowSession, "join_closes_at"))
                .isEqualTo(instantOf(windowSession, "starts_at"));
        assertThat(instantOf(windowSession, "closes_at"))
                .isEqualTo(OffsetDateTime.parse("2026-08-10T12:00:00+09:00").toInstant());
        assertThat(instantOf(windowSession, "settle_after"))
                .isEqualTo(OffsetDateTime.parse("2026-08-10T12:30:00+09:00").toInstant());
    }

    @Test
    @DisplayName("구 자정 걸침 창(22:00~01:00)의 회차 종료는 익일이다 — V35(걸침 금지) 이전 이력 수용")
    void midnightCrossingLegacyWindowClosesNextDay() {
        // 신 스키마(B1 V35 이후)는 걸침 창을 저장할 수 없으므로 구 스키마에서만 의미 있는 검증이다.
        migrate("38");
        if (!hasColumn("group_challenge_windows", "window_start_at")) {
            return;
        }
        UUID userId = insertUser("재영");
        UUID groupId = insertGroup("스터디");
        UUID challengeId = insertChallenge(groupId, "FOCUS", "TIME_WINDOW");
        insertWindow(challengeId, "22:00", "01:00", 60);
        UUID betId = insertBet(groupId, challengeId, userId, 30, TODAY, "OPEN", null);
        insertParticipant(betId, userId);

        migrate("39");

        Map<String, Object> session = sessionOf(betId);
        assertThat(instantOf(session, "starts_at"))
                .isEqualTo(OffsetDateTime.parse("2026-08-10T22:00:00+09:00").toInstant());
        assertThat(instantOf(session, "closes_at"))
                .isEqualTo(OffsetDateTime.parse("2026-08-11T01:00:00+09:00").toInstant());
    }

    @Test
    @DisplayName("CANCELED 내기는 '없던 일' — 회차도 참가 행도 남지 않고, 취소 이력뿐인 챌린지는 설정도 없다")
    void purgesCanceledBetsAndSkipsCanceledOnlyChallenges() {
        migrate("38");
        UUID userId = insertUser("재영");
        UUID groupId = insertGroup("스터디");
        // 취소 이력만 있는 챌린지 — 설정이 생기면 안 된다.
        UUID canceledOnlyChallengeId = insertChallenge(groupId, "FOCUS", "DURATION");
        insertDuration(canceledOnlyChallengeId, 120);
        UUID canceledBetId = insertBet(groupId, canceledOnlyChallengeId, userId, 30, TODAY, "CANCELED", null);
        insertParticipant(canceledBetId, userId);
        // 취소 + 정산이 섞인 챌린지 — 설정은 생기되 취소 회차는 없다. 카테고리를 갈라 두는 이유:
        // V20 부분 유니크(활성 그룹·카테고리·타입당 1개)가 같은 조합의 활성 챌린지 2개를 거절한다.
        UUID mixedChallengeId = insertChallenge(groupId, "SCREEN_TIME", "DURATION");
        insertDuration(mixedChallengeId, 120);
        UUID mixedCanceledBetId = insertBet(groupId, mixedChallengeId, userId, 30, YESTERDAY, "CANCELED", null);
        UUID mixedSettledBetId = insertBet(groupId, mixedChallengeId, userId, 30, YESTERDAY.minusDays(1),
                "SETTLED", 120);
        insertParticipant(mixedCanceledBetId, userId);
        insertParticipant(mixedSettledBetId, userId);

        migrate("39");

        assertThat(countWhere("group_challenge_bets", "challenge_id", canceledOnlyChallengeId)).isZero();
        assertThat(countWhere("group_challenge_bet_sessions", "challenge_id", canceledOnlyChallengeId))
                .isZero();
        assertThat(countWhere("group_challenge_bets", "challenge_id", mixedChallengeId)).isEqualTo(1);
        assertThat(countWhere("group_challenge_bet_sessions", "challenge_id", mixedChallengeId))
                .isEqualTo(1);
        // 취소 내기의 참가 행은 정리되고, 정산 내기의 참가 행만 남는다.
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM group_challenge_bet_participants WHERE session_id = ?",
                Integer.class, mixedSettledBetId)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM group_challenge_bet_participants", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("새 유니크가 DB 에 실재한다 — 챌린지당 설정 1개 · 설정당 하루 1회차 · 회차당 유저 1참가")
    void enforcesTwoTierUniques() {
        migrate("38");
        UUID userId = insertUser("재영");
        UUID groupId = insertGroup("스터디");
        UUID challengeId = insertChallenge(groupId, "FOCUS", "DURATION");
        insertDuration(challengeId, 120);
        UUID betId = insertBet(groupId, challengeId, userId, 30, TODAY, "OPEN", null);
        insertParticipant(betId, userId);

        migrate("39");

        UUID configId = jdbc.queryForObject(
                "SELECT id FROM group_challenge_bets WHERE challenge_id = ?", UUID.class, challengeId);
        // 챌린지당 설정 1개.
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO group_challenge_bets (id, group_id, challenge_id, stake, enabled,"
                        + " created_at, updated_at) VALUES (?, ?, ?, 30, true, now(), now())",
                UUID.randomUUID(), groupId, challengeId))
                .hasMessageContaining("uq_group_challenge_bets_challenge");
        // 설정·날짜당 회차 1개 — 구 FR-7 부분 유니크의 대체(전체 유니크).
        assertThatThrownBy(() -> insertSession(UUID.randomUUID(), configId, groupId, challengeId, TODAY))
                .hasMessageContaining("uq_group_challenge_bet_sessions_bet_date");
        // 회차당 유저 1참가.
        assertThatThrownBy(() -> insertParticipant(betId, userId))
                .hasMessageContaining("uq_group_challenge_bet_participants_session_user");
    }

    // ── 시드 헬퍼 (신·구 스키마 겸용) ─────────────────────────────────────

    private boolean hasColumn(String table, String column) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.columns"
                        + " WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
                Integer.class, table, column);
        return count != null && count > 0;
    }

    private UUID insertUser(String nickname) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, created_at, is_guest, nickname, is_deleted)"
                + " VALUES (?, now(), false, ?, false)", id, nickname);
        return id;
    }

    private UUID insertGroup(String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name,"
                + " status) VALUES (?, false, 'OWNER_ONLY', 10, ?, 'ACTIVE')", id, name);
        return id;
    }

    /** 선행 배치(B1 V34)가 추가할 수 있는 컬럼(repeat_days·started_at 등)을 존재 시에만 채운다. */
    private UUID insertChallenge(UUID groupId, String category, String type) {
        UUID id = UUID.randomUUID();
        StringBuilder columns = new StringBuilder("id, group_id, category, type, status, created_at");
        StringBuilder values = new StringBuilder("?, ?, ?, ?, 'ACTIVE', now()");
        if (hasColumn("group_challenges", "repeat_days")) {
            columns.append(", repeat_days");
            values.append(", 127");
        }
        if (hasColumn("group_challenges", "started_at")) {
            columns.append(", started_at");
            values.append(", now()");
        }
        jdbc.update("INSERT INTO group_challenges (" + columns + ") VALUES (" + values + ")",
                id, groupId, category, type);
        return id;
    }

    private void insertDuration(UUID challengeId, int minutes) {
        if (hasColumn("group_challenge_durations", "category")) {
            // B1 V36 이후 — 카테고리 비정규화 복사 컬럼을 부모 값으로 채운다.
            jdbc.update("INSERT INTO group_challenge_durations (challenge_id, duration_minutes, category)"
                    + " SELECT ?, ?, category FROM group_challenges WHERE id = ?",
                    challengeId, minutes, challengeId);
            return;
        }
        jdbc.update("INSERT INTO group_challenge_durations (challenge_id, duration_minutes)"
                + " VALUES (?, ?)", challengeId, minutes);
    }

    /** 창 시각은 KST 벽시계 — 구 스키마는 timestamptz(KST 규약), 신 스키마는 time 컬럼에 넣는다. */
    private void insertWindow(UUID challengeId, String startKst, String endKst, Integer goalMinutes) {
        if (hasColumn("group_challenge_windows", "window_start_at")) {
            jdbc.update("INSERT INTO group_challenge_windows"
                    + " (challenge_id, window_start_at, window_end_at, duration_minutes)"
                    + " VALUES (?, ?::timestamptz, ?::timestamptz, ?)",
                    challengeId,
                    "2026-01-01 " + startKst + ":00+09",
                    "2026-01-01 " + endKst + ":00+09",
                    goalMinutes);
            return;
        }
        jdbc.update("INSERT INTO group_challenge_windows"
                + " (challenge_id, window_start, window_end, duration_minutes)"
                + " VALUES (?, ?::time, ?::time, ?)", challengeId, startKst, endKst, goalMinutes);
    }

    private UUID insertBet(UUID groupId, UUID challengeId, UUID creatorId, int stake,
            LocalDate betDate, String status, Integer goalMinutes) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO group_challenge_bets (id, group_id, challenge_id, creator_user_id,"
                + " stake, bet_date, status, goal_minutes, settled_at, created_at, updated_at)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, ?,"
                + " CASE WHEN ? IN ('SETTLED', 'REFUNDED', 'FORFEITED') THEN now() END, now(), now())",
                id, groupId, challengeId, creatorId, stake, betDate, status, goalMinutes, status);
        return id;
    }

    private UUID insertParticipant(UUID betOrSessionId, UUID userId) {
        UUID id = UUID.randomUUID();
        String axis = hasColumn("group_challenge_bet_participants", "session_id")
                ? "session_id" : "bet_id";
        jdbc.update("INSERT INTO group_challenge_bet_participants (id, " + axis + ", user_id, created_at)"
                + " VALUES (?, ?, ?, now())", id, betOrSessionId, userId);
        return id;
    }

    private void insertSession(UUID id, UUID betId, UUID groupId, UUID challengeId, LocalDate date) {
        jdbc.update("INSERT INTO group_challenge_bet_sessions (id, bet_id, group_id, challenge_id,"
                + " session_date, stake, goal_minutes, mission_category, mission_type, status,"
                + " starts_at, join_closes_at, closes_at, settle_after, settle_attempts,"
                + " created_at, updated_at)"
                + " VALUES (?, ?, ?, ?, ?, 30, 120, 'FOCUS', 'DURATION', 'OPEN',"
                + " now(), now(), now(), now(), 0, now(), now())",
                id, betId, groupId, challengeId, date);
    }

    private Map<String, Object> sessionOf(UUID sessionId) {
        return jdbc.queryForMap("SELECT * FROM group_challenge_bet_sessions WHERE id = ?", sessionId);
    }

    private int countWhere(String table, String column, UUID value) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM " + table + " WHERE " + column + " = ?", Integer.class, value);
        return count == null ? 0 : count;
    }

    private java.time.Instant instantOf(Map<String, Object> row, String column) {
        return ((java.sql.Timestamp) row.get(column)).toInstant();
    }

    private void migrate(String target) {
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(resolveTarget(target))
                .load();
        flyway.migrate();
    }

    /**
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다 — 선행 배치(B1·B2)의 V34~V38 이
     * 아직 없는 워크트리에서는 "38" 이 33 으로, 머지 후에는 38 그대로 해석된다(Flyway 는 존재하지
     * 않는 target 을 오류로 본다).
     */
    private MigrationVersion resolveTarget(String requested) {
        MigrationVersion wanted = MigrationVersion.fromVersion(requested);
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load();
        MigrationVersion best = null;
        for (org.flywaydb.core.api.MigrationInfo info : flyway.info().all()) {
            MigrationVersion version = info.getVersion();
            if (version == null || version.compareTo(wanted) > 0) {
                continue;
            }
            if (best == null || version.compareTo(best) > 0) {
                best = version;
            }
        }
        if (best == null) {
            throw new IllegalStateException("적용 가능한 마이그레이션이 없습니다 — target=" + requested);
        }
        return best;
    }

    private JdbcTemplate jdbcTemplate() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}
