package com.oneorthree.notification;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** V14 발송 작업 원인 문맥 열의 실 SQL 검증(GROMO-2557). V13 까지 올려 기존 발송 행을 넣은 뒤 V14 를 태운다. */
@Testcontainers
class DeliveryOriginV14MigrationTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");

    @Test
    void addsNullableOriginColumnsAndKeepsExistingDeliveries() {
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(
                PG.getJdbcUrl(), PG.getUsername(), PG.getPassword()));
        migrate(MigrationVersion.fromVersion("13"));
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO deliveries(id,event_id,user_id,kind,payload,status) VALUES(?,?,?,"
                + "'FRIEND_REQUEST','{\"kind\":\"FRIEND_REQUEST\"}'::jsonb,'PENDING')", id, "before-v14", UUID.randomUUID());
        Map<String, Object> before = jdbc.queryForMap("SELECT * FROM deliveries WHERE id=?", id);

        migrate(MigrationVersion.LATEST);

        assertThat(jdbc.queryForMap("SELECT * FROM deliveries WHERE id=?", id)).containsAllEntriesOf(before)
                .containsEntry("origin_request_id", null).containsEntry("origin_trace_id", null);
        List<String> columns = jdbc.queryForList("SELECT column_name||':'||data_type||':'||character_maximum_length"
                + "||':'||is_nullable||':'||coalesce(column_default,'none') FROM information_schema.columns"
                + " WHERE table_name='deliveries' AND column_name LIKE 'origin_%' ORDER BY column_name", String.class);
        assertThat(columns).containsExactly("origin_request_id:character varying:128:YES:none",
                "origin_trace_id:character varying:64:YES:none");
    }

    private static void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }
}
