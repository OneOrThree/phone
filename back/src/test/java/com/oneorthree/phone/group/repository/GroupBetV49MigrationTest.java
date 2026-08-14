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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V49(결과 확인 표시 ack + 표시 선점, GROMO-1577 · N58·B17 · 계약 §6)의 실 SQL 검증.
 *
 * <p>보는 것: ① V48 까지는 세 컬럼이 없다, ② V49 가 nullable 로 추가하고 값을 저장·조회할 수 있다,
 * ③ <b>백필(계약 V4)</b> — 이미 결과가 된 참가 행은 확인 처리되고, <b>아직 정산되지 않은 OPEN 회차의
 * 참가 행은 건드리지 않는다.</b>
 *
 * <p>③의 두 번째 절이 이 테스트의 핵심이다. 백필이 없으면 배포 직후 재설치·새 기기 사용자가 이미
 * 본 결과를 최대 10건 다시 보고(N58 이 막으려던 재생), 반대로 <b>OPEN 회차까지</b> 칠하면 배포 시점에
 * 진행 중이던 회차가 나중에 정산됐을 때 그 결과를 <b>어느 기기에서도 못 본다</b>(아무도 못 본 결과의
 * 유실). 두 방향 모두 실 SQL 로만 드러난다 — CI 는 {@code create-drop} 이라 Flyway 를 돌리지 않는다.
 */
class GroupBetV49MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private static final LocalDate TODAY = LocalDate.of(2026, 8, 14);
    private static final String TABLE = "group_challenge_bet_participants";

    private JdbcTemplate jdbc;
    private UUID groupId;
    private UUID challengeId;
    private UUID configId;
    private UUID userId;

    @BeforeEach
    void resetSchema() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("V48 까지는 ack·선점 컬럼이 없고, V49 이후 nullable 로 추가돼 값을 저장·조회할 수 있다")
    void addsAckAndDisplayClaimColumnsAtV49() {
        seedAt("48");
        assertThat(hasColumn(TABLE, "acknowledged_at")).isFalse();
        assertThat(hasColumn(TABLE, "display_claimed_at")).isFalse();
        assertThat(hasColumn(TABLE, "display_claim_token")).isFalse();
        UUID openParticipant = insertParticipant(sessionOn(TODAY, "OPEN"));

        migrate("49");

        assertThat(hasColumn(TABLE, "acknowledged_at")).isTrue();
        assertThat(hasColumn(TABLE, "display_claimed_at")).isTrue();
        assertThat(hasColumn(TABLE, "display_claim_token")).isTrue();

        // 선점 저장·조회 — claimDisplay 가 쓰는 그대로(시각 + 토큰).
        UUID token = UUID.randomUUID();
        jdbc.update("UPDATE " + TABLE + " SET display_claimed_at = now(), display_claim_token = ?"
                + " WHERE id = ?", token, openParticipant);
        assertThat(jdbc.queryForObject(
                "SELECT display_claim_token FROM " + TABLE + " WHERE id = ?", UUID.class, openParticipant))
                .isEqualTo(token);
        assertThat(jdbc.queryForObject(
                "SELECT display_claimed_at FROM " + TABLE + " WHERE id = ?",
                OffsetDateTime.class, openParticipant)).isNotNull();
    }

    @Test
    @DisplayName("백필(V4) — 이미 결과가 된 참가 행만 확인 처리되고, OPEN 회차 참가 행은 미확인으로 남는다")
    void backfillsOnlySettledParticipations() {
        seedAt("48");
        // 결과 4종 — 배포 시각 이전에 이미 사용자가 봤을 수 있는 결과다(재생 방지 대상).
        UUID settled = insertParticipant(sessionOn(TODAY.minusDays(1), "SETTLED"));
        UUID forfeited = insertParticipant(sessionOn(TODAY.minusDays(2), "FORFEITED"));
        UUID voided = insertParticipant(sessionOn(TODAY.minusDays(3), "VOIDED"));
        UUID refunded = insertParticipant(sessionOn(TODAY.minusDays(4), "REFUNDED"));
        // 아직 결과가 아니다 — 여기까지 칠하면 나중에 정산됐을 때 아무도 못 본 결과가 유실된다.
        UUID open = insertParticipant(sessionOn(TODAY, "OPEN"));

        migrate("49");

        assertThat(acknowledgedAt(settled)).as("정산 결과는 확인 처리된다").isNotNull();
        assertThat(acknowledgedAt(forfeited)).isNotNull();
        assertThat(acknowledgedAt(voided)).isNotNull();
        assertThat(acknowledgedAt(refunded)).isNotNull();
        assertThat(acknowledgedAt(open))
                .as("아직 정산되지 않은 회차의 참가 행은 백필 대상이 아니다 — 칠하면 그 결과를 영영 못 본다")
                .isNull();
        // 선점 컬럼은 백필하지 않는다 — 확인과 선점은 다른 상태다(IA §4.3).
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM " + TABLE + " WHERE display_claimed_at IS NOT NULL"
                        + " OR display_claim_token IS NOT NULL", Integer.class)).isZero();
    }

    private OffsetDateTime acknowledgedAt(UUID participantId) {
        return jdbc.queryForObject(
                "SELECT acknowledged_at FROM " + TABLE + " WHERE id = ?",
                OffsetDateTime.class, participantId);
    }

    // ── 시드 (V42·V44 테스트 관례) ───────────────────────────────────────

    private void seedAt(String target) {
        migrate(target);
        userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, created_at, is_guest, nickname, is_deleted)"
                + " VALUES (?, now(), false, '재영', false)", userId);
        groupId = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, is_chat_enabled, invite_permission, max_members, name,"
                + " status) VALUES (?, false, 'OWNER_ONLY', 10, '스터디', 'ACTIVE')", groupId);
        challengeId = UUID.randomUUID();
        StringBuilder columns = new StringBuilder("id, group_id, category, type, status, created_at");
        StringBuilder values = new StringBuilder("?, ?, 'FOCUS', 'DURATION', 'ACTIVE', now()");
        if (hasColumn("group_challenges", "repeat_days")) {
            columns.append(", repeat_days");
            values.append(", 127");
        }
        if (hasColumn("group_challenges", "started_at")) {
            columns.append(", started_at");
            values.append(", now()");
        }
        jdbc.update("INSERT INTO group_challenges (" + columns + ") VALUES (" + values + ")",
                challengeId, groupId);
        configId = UUID.randomUUID();
        jdbc.update("INSERT INTO group_challenge_bets (id, group_id, challenge_id, stake, enabled,"
                + " created_at, updated_at) VALUES (?, ?, ?, 30, true, now(), now())",
                configId, groupId, challengeId);
    }

    private UUID sessionOn(LocalDate date, String status) {
        UUID sessionId = UUID.randomUUID();
        jdbc.update("INSERT INTO group_challenge_bet_sessions (id, bet_id, group_id, challenge_id,"
                + " session_date, stake, goal_minutes, mission_category, mission_type, status,"
                + " starts_at, join_closes_at, closes_at, settle_after, settle_attempts,"
                + " settled_at, created_at, updated_at)"
                + " VALUES (?, ?, ?, ?, ?, 30, 120, 'FOCUS', 'DURATION', ?,"
                + " now(), now(), now(), now(), 0, ?, now(), now())",
                sessionId, configId, groupId, challengeId, date, status,
                "OPEN".equals(status) ? null : OffsetDateTime.now());
        return sessionId;
    }

    private UUID insertParticipant(UUID sessionId) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO " + TABLE + " (id, session_id, user_id, created_at)"
                + " VALUES (?, ?, ?, now())", id, sessionId, userId);
        return id;
    }

    private boolean hasColumn(String table, String column) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.columns"
                        + " WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
                Integer.class, table, column);
        return count != null && count > 0;
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
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다(V41·V42·V44 테스트 관례) —
     * 선행 배치의 마이그레이션이 아직 없는 워크트리에서도 돌게 하는 장치다(Flyway 는 존재하지 않는
     * target 을 오류로 본다).
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
}
