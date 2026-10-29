package com.oneorthree.phone.outbox.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V5 원인 문맥 열의 실 SQL 검증 (GROMO-2557). V4 까지 올려 이전 이미지가 적은 그대로 봉투·전달 행을 넣은 뒤 V5 를 태운다 —
 * 기존 행은 값이 그대로이고 새 열만 null 이어야 relay 가 그 행을 계속 보낼 수 있다.
 */
class OutboxOriginV5MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    @Test
    @DisplayName("V4 위의 기존 봉투는 V5 뒤에도 그대로이고 새 열 셋은 null, 기본값·NOT NULL 없음")
    void addsNullableOriginColumnsWithoutTouchingExistingRows() {
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        migrate(MigrationVersion.fromVersion("4"));
        UUID outboxId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO event_outbox (id, event_id, schema_version, type, occurred_at, user_id, aggregate_type,"
                + " aggregate_id, version, params, created_at) VALUES (?, 'evt-before-v5', 1, 'notification.requested',"
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

    /**
     * 롤백 공존 — 이전 이미지의 {@code db/v0} 번들에는 V5 가 없다. 그 번들로 V5 가 적용된 DB 를 migrate·validate 해도 통과해야 한다.
     * 근거는 Flyway 기본 {@code ignore-migration-patterns=*:future}(적용됐지만 로컬에 없는 더 높은 버전은 무시) 하나뿐이다.
     * dev/prod 설정은 이 값을 건드리지 않고 {@code out-of-order: false} 만 둔다 — 아래도 같은 옵션만 쓴다.
     * 이 기본값이 바뀌거나 설정에 {@code ignoreMigrationPatterns} 가 들어오면 이 테스트가 먼저 깨져야 한다.
     */
    @Test
    @DisplayName("V5 까지 적용된 DB 를 V5 없는 번들(V0~V4)로 migrate·validate 해도 통과한다")
    void rollbackBundleWithoutV5StillValidatesAppliedV5(@TempDir Path previousImage) throws IOException {
        migrate(MigrationVersion.LATEST);
        for (String name : List.of("V0__baseline.sql", "V1__focus_session_details_seat.sql",
                "V2__construction_buildings.sql", "V3__deferred_uninhabited_island.sql",
                "V4__content_review_publications.sql")) {
            Files.copy(Path.of("src/main/resources/db/v0", name), previousImage.resolve(name));
        }

        Flyway previous = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("filesystem:" + previousImage).outOfOrder(false).load();
        previous.migrate();
        previous.validate();

        assertThat(new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()))
                .queryForObject("SELECT max(version::int) FROM flyway_schema_history WHERE success", Integer.class))
                .as("V5 기록이 그대로 남는다").isEqualTo(5);
    }
}
