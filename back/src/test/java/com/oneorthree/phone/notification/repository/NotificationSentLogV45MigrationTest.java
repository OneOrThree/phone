package com.oneorthree.phone.notification.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V45(notification_sent_logs 클레임 확장 + shedlock, GROMO-1417·1283·N41)의 실 SQL 검증.
 *
 * <p>보는 것: ① 기존 행이 {@code kind=type}·{@code status='SENT'} 로 백필된다,
 * ② 사건 유니크 {@code (user_id, kind, subject_id)} 가 중복 클레임을 거절하고
 * {@code ON CONFLICT DO NOTHING} 선점이 0행으로 조용히 지는 반면 {@code subject_id NULL}
 * 인 레거시 행끼리는 충돌하지 않는다, ③ status CHECK 3종, ④ shedlock 테이블 존재.
 */
class NotificationSentLogV45MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    private JdbcTemplate jdbc;

    @BeforeEach
    void resetSchema() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("기존 행은 kind=type · status=SENT 로 백필되고, sent_at NOT NULL 이 풀린다")
    void backfillsKindAndStatusForLegacyRows() {
        migrate("41");
        UUID userId = UUID.randomUUID();
        UUID legacyId = UUID.randomUUID();
        jdbc.update("INSERT INTO notification_sent_logs (id, user_id, type, sent_at)"
                + " VALUES (?, ?, 'RANK_OVERTAKE', now())", legacyId, userId);

        migrate("45");

        assertThat(jdbc.queryForObject(
                "SELECT kind FROM notification_sent_logs WHERE id = ?", String.class, legacyId))
                .isEqualTo("RANK_OVERTAKE");
        assertThat(jdbc.queryForObject(
                "SELECT status FROM notification_sent_logs WHERE id = ?", String.class, legacyId))
                .isEqualTo("SENT");
        // PENDING 클레임 행은 발송 전이라 sent_at 이 없어야 한다.
        jdbc.update("INSERT INTO notification_sent_logs (id, user_id, type, kind, subject_id,"
                + " status, claimed_at) VALUES (?, ?, 'BET_RESULT', 'BET_RESULT', ?, 'PENDING', now())",
                UUID.randomUUID(), userId, UUID.randomUUID());
    }

    @Test
    @DisplayName("사건 유니크 (user_id, kind, subject_id) — 중복은 거절, NULL subject 레거시 행은 공존")
    void enforcesEventUniqueButAllowsNullSubjects() {
        migrate("45");
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        insertClaim(userId, "BET_RESULT", sessionId);

        assertThatThrownBy(() -> insertClaim(userId, "BET_RESULT", sessionId))
                .hasMessageContaining("uq_notification_sent_logs_user_kind_subject");

        // 같은 kind 라도 회차(subject)가 다르면 별도 사건이다 — N41 의 핵심.
        insertClaim(userId, "BET_RESULT", UUID.randomUUID());
        // ON CONFLICT DO NOTHING 선점 — 중복은 0행으로 조용히 진다(파이프라인의 클레임 계약).
        int claimed = jdbc.update("INSERT INTO notification_sent_logs"
                + " (id, user_id, type, kind, subject_id, status, claimed_at)"
                + " VALUES (?, ?, 'BET_RESULT', 'BET_RESULT', ?, 'PENDING', now())"
                + " ON CONFLICT (user_id, kind, subject_id) DO NOTHING",
                UUID.randomUUID(), userId, sessionId);
        assertThat(claimed).isZero();

        // 레거시 꼴 행(subject NULL)은 유니크에서 서로 다른 값으로 취급돼 여러 건 공존한다
        // (V45 이후의 raw INSERT 는 kind 를 함께 채운다 — JPA 경로는 @PrePersist 가 미러링).
        jdbc.update("INSERT INTO notification_sent_logs (id, user_id, type, kind, sent_at)"
                + " VALUES (?, ?, 'RANK_OVERTAKE', 'RANK_OVERTAKE', now())", UUID.randomUUID(), userId);
        jdbc.update("INSERT INTO notification_sent_logs (id, user_id, type, kind, sent_at)"
                + " VALUES (?, ?, 'RANK_OVERTAKE', 'RANK_OVERTAKE', now())", UUID.randomUUID(), userId);
    }

    @Test
    @DisplayName("status CHECK — PENDING·DEFERRED·SENT 만 허용하고, shedlock 테이블이 생긴다")
    void enforcesStatusDomainAndCreatesShedlock() {
        migrate("45");
        UUID userId = UUID.randomUUID();

        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO notification_sent_logs (id, user_id, type, kind, subject_id, status)"
                        + " VALUES (?, ?, 'BET_RESULT', 'BET_RESULT', ?, 'SOMETHING')",
                UUID.randomUUID(), userId, UUID.randomUUID()))
                .hasMessageContaining("notification_sent_logs_status_check");

        jdbc.update("INSERT INTO shedlock (name, lock_until, locked_at, locked_by)"
                + " VALUES ('test-lock', now(), now(), 'migration-test')");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM shedlock WHERE name = 'test-lock'", Integer.class))
                .isEqualTo(1);
    }

    private void insertClaim(UUID userId, String kind, UUID subjectId) {
        jdbc.update("INSERT INTO notification_sent_logs"
                + " (id, user_id, type, kind, subject_id, status, claimed_at)"
                + " VALUES (?, ?, ?, ?, ?, 'PENDING', now())",
                UUID.randomUUID(), userId, kind, kind, subjectId);
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
     * 요청 버전 이하의 <b>실재하는</b> 최고 버전으로 타깃을 해석한다 — 병렬 배치의 결번
     * (V42=B4 · V43·V44=B6 예약)이 있어도 Flyway 가 존재하지 않는 target 을 오류로 보지 않게 한다
     * (GroupBetV41MigrationTest 와 같은 규율).
     */
    private MigrationVersion resolveTarget(String requested) {
        MigrationVersion wanted = MigrationVersion.fromVersion(requested);
        Flyway flyway = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load();
        MigrationVersion best = null;
        for (MigrationInfo info : flyway.info().all()) {
            MigrationVersion version = info.getVersion();
            if (version == null || version.compareTo(wanted) > 0) {
                continue;
            }
            if (best == null || version.compareTo(best) > 0) {
                best = version;
            }
        }
        return best == null ? wanted : best;
    }
}
