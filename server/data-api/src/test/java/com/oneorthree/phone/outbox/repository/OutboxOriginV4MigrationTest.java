package com.oneorthree.phone.outbox.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V4 원인 문맥 열의 실 SQL 검증 (GROMO-2557). V3 까지 올려 이전 이미지가 적은 그대로 봉투·전달 행을 넣은 뒤 V4 를 태운다 —
 * 기존 행은 값이 그대로이고 새 열만 null 이어야 relay 가 그 행을 계속 보낼 수 있다.
 */
class OutboxOriginV4MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    @Test
    @DisplayName("V3 위의 기존 봉투는 V4 뒤에도 그대로이고 새 열 셋은 null, 기본값·NOT NULL 없음")
    void addsNullableOriginColumnsWithoutTouchingExistingRows() {
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        migrate(MigrationVersion.fromVersion("3"));
        UUID outboxId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO event_outbox (id, event_id, schema_version, type, occurred_at, user_id, aggregate_type,"
                + " aggregate_id, version, params, created_at) VALUES (?, 'evt-before-v4', 1, 'notification.requested',"
                + " now(), ?, 'USER', ?, 1, '{\"kind\":\"FRIEND_REQUEST\"}'::jsonb, now())",
                outboxId, userId, userId.toString());
        jdbc.update("INSERT INTO event_outbox_deliveries (id, outbox_id, target, aggregate_type, aggregate_id,"
                + " aggregate_version, payload, attempt_count, next_attempt_at, created_at)"
                + " VALUES (?, ?, 'KAFKA', 'USER', ?, 1, '{}'::jsonb, 0, now(), now())",
                UUID.randomUUID(), outboxId, userId.toString());
        Map<String, Object> before = jdbc.queryForMap("SELECT * FROM event_outbox WHERE id = ?", outboxId);

        migrate(MigrationVersion.LATEST);

        Map<String, Object> after = jdbc.queryForMap("SELECT * FROM event_outbox WHERE id = ?", outboxId);
        assertThat(after).containsAllEntriesOf(before)
                .containsEntry("origin_request_id", null)
                .containsEntry("origin_trace_id", null)
                .containsEntry("trace_context_version", null);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM event_outbox_deliveries WHERE outbox_id = ?",
                Integer.class, outboxId)).isEqualTo(1);
        List<Map<String, Object>> columns = jdbc.queryForList("SELECT column_name, data_type, character_maximum_length,"
                + " is_nullable, column_default FROM information_schema.columns WHERE table_name = 'event_outbox'"
                + " AND column_name IN ('origin_request_id', 'origin_trace_id', 'trace_context_version')"
                + " ORDER BY column_name");
        assertThat(columns).extracting(c -> c.get("column_name") + ":" + c.get("data_type") + ":"
                        + c.get("character_maximum_length") + ":" + c.get("is_nullable") + ":" + c.get("column_default"))
                .containsExactly(
                        "origin_request_id:character varying:128:YES:null",
                        "origin_trace_id:character varying:64:YES:null",
                        "trace_context_version:smallint:null:YES:null");
    }

    private static void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/v0")
                .target(target)
                .load()
                .migrate();
    }
}
