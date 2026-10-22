package com.oneorthree.phone.outbox.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V138 LINK 전달 행 정리의 실 SQL 검증 (GROMO-2407). {@code IslandArrivalV112MigrationTest} 선례 —
 * 전용 컨테이너에 V137 까지 적용해 시드한 뒤 V138 을 태운다.
 */
class OutboxLinkV138MigrationTest {

    /** LINK 전달만 만드는 사건 종류 6종 — V138 의 목록과 같아야 한다(producer 상수는 각 줄 주석). */
    private static final List<String> LINK_ONLY_TYPES = List.of(
            "link.revoked",             // LinkMembershipEventService.EVENT_LINK_REVOKED
            "link.joined",              // LinkMembershipEventService.EVENT_LINK_JOINED
            "group.closed",             // LinkMembershipEventService.EVENT_GROUP_CLOSED
            "group.renamed",            // LinkMembershipEventService.EVENT_GROUP_RENAMED
            "user.displayNameChanged",  // LinkMembershipEventService.EVENT_DISPLAY_NAME_CHANGED
            "link.claimConfirmed");     // InternalInviteLinkService.EVENT_CLAIM_CONFIRMED

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
    @DisplayName("LINK 전달만 달린 봉투는 6개 사건 종류 모두 전달 행과 함께 사라진다 — 시도했다 실패한 행도 포함")
    void removesLinkOnlyEnvelopesOfEveryLinkType() {
        migrate(MigrationVersion.fromVersion("137"));
        for (String type : LINK_ONLY_TYPES) {
            UUID outboxId = envelope(type);
            delivery(outboxId, "LINK", 7);
        }

        migrate(MigrationVersion.LATEST);

        assertThat(count("SELECT count(*) FROM event_outbox_deliveries WHERE target = 'LINK'")).isZero();
        assertThat(count("SELECT count(*) FROM event_outbox")).as("LINK 만 갖던 봉투 6개").isZero();
    }

    @Test
    @DisplayName("user.withdrawn 은 LINK 전달만 빠지고 봉투와 KAFKA·REALTIME·SCORE 전달은 그대로 남는다")
    void keepsWithdrawnEnvelopeAndItsOtherDeliveries() {
        migrate(MigrationVersion.fromVersion("137"));
        UUID outboxId = envelope("user.withdrawn");
        delivery(outboxId, "KAFKA", 0);
        delivery(outboxId, "LINK", 3);
        delivery(outboxId, "REALTIME", 0);
        delivery(outboxId, "SCORE", 0);

        migrate(MigrationVersion.LATEST);

        assertThat(count("SELECT count(*) FROM event_outbox WHERE id = ?", outboxId)).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT target FROM event_outbox_deliveries WHERE outbox_id = ?",
                String.class, outboxId)).containsExactlyInAnyOrder("KAFKA", "REALTIME", "SCORE");
    }

    @Test
    @DisplayName("LINK 사건 종류라도 다른 대상의 전달이 남아 있으면 봉투를 지우지 않는다")
    void keepsLinkTypeEnvelopeThatStillHasOtherDeliveries() {
        migrate(MigrationVersion.fromVersion("137"));
        UUID outboxId = envelope("group.renamed");
        delivery(outboxId, "LINK", 2);
        delivery(outboxId, "REALTIME", 0);

        migrate(MigrationVersion.LATEST);

        assertThat(count("SELECT count(*) FROM event_outbox WHERE id = ?", outboxId)).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT target FROM event_outbox_deliveries WHERE outbox_id = ?",
                String.class, outboxId)).containsExactly("REALTIME");
    }

    @Test
    @DisplayName("목록 밖 종류는 전달 행이 없어도 봉투를 남긴다 — focus.golden 원장과 미지의 종류를 일괄 삭제에서 지킨다")
    void keepsEnvelopesWithoutDeliveriesOutsideTheLinkTypeList() {
        migrate(MigrationVersion.fromVersion("137"));
        UUID golden = envelope("focus.golden");
        UUID unlisted = envelope("island.updated");
        delivery(unlisted, "LINK", 1);

        migrate(MigrationVersion.LATEST);

        assertThat(count("SELECT count(*) FROM event_outbox WHERE id = ?", golden)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM event_outbox WHERE id = ?", unlisted)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM event_outbox_deliveries WHERE outbox_id = ?", unlisted))
                .as("LINK 전달 행은 종류와 무관하게 지운다").isZero();
    }

    // ── 시드 ────────────────────────────────────────────────────────────

    /** 유저 축 봉투 한 건 — 축마다 새 유저라 (축, version) 유일 제약과 부딪히지 않는다. */
    private UUID envelope(String type) {
        UUID id = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO event_outbox (id, event_id, schema_version, type, occurred_at, user_id,"
                        + " aggregate_type, aggregate_id, version, params, created_at)"
                        + " VALUES (?, ?, 1, ?, now(), ?, 'USER', ?, 1, '{}'::jsonb, now())",
                id, type + ":" + id, type, userId, userId.toString());
        return id;
    }

    private void delivery(UUID outboxId, String target, int attemptCount) {
        jdbc.update("INSERT INTO event_outbox_deliveries (id, outbox_id, target, aggregate_type, aggregate_id,"
                        + " aggregate_version, payload, attempt_count, next_attempt_at, created_at)"
                        + " SELECT ?, o.id, ?, o.aggregate_type, o.aggregate_id, o.version, '{}'::jsonb, ?, now(), now()"
                        + " FROM event_outbox o WHERE o.id = ?",
                UUID.randomUUID(), target, attemptCount, outboxId);
    }

    private int count(String sql, Object... args) {
        Integer found = jdbc.queryForObject(sql, Integer.class, args);
        return found == null ? 0 : found;
    }

    private void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }
}
