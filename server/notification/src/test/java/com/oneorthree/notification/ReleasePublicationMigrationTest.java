package com.oneorthree.notification;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

/** 실제 운영 이력 V9에서 선택 이행하여 기존 종류·묶음 잡·저장소 보존을 확인한다. */
@Testcontainers
class ReleasePublicationMigrationTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");

    @Test
    void upgradeFromV9PreservesLegacyCatalogAndAddsReviewedPublicationStorage() {
        var source = new DriverManagerDataSource(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword());
        var jdbc = new JdbcTemplate(source);
        Flyway.configure().dataSource(source).target("9").load().migrate();
        jdbc.update("UPDATE templates SET body='운영 사용자 지정 문구' WHERE id='FRIEND_REQUEST.ko'");
        Flyway flyway = Flyway.configure().dataSource(source).load();
        assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
        flyway.validate();
        assertThat(jdbc.queryForObject("SELECT body FROM templates WHERE id='FRIEND_REQUEST.ko'", String.class))
                .isEqualTo("운영 사용자 지정 문구");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM kinds WHERE enabled", Integer.class)).isEqualTo(27);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM jobs WHERE id='bundle-flush'", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT to_regclass('result_ack')::text", String.class)).isEqualTo("result_ack");
        assertThat(jdbc.queryForObject("SELECT to_regclass('deliveries_history_order')::text", String.class))
                .isEqualTo("deliveries_history_order");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM information_schema.columns"
                + " WHERE table_name='deliveries' AND column_name='reviewed_push'", Integer.class)).isEqualTo(1);
        assertThat(flyway.migrate().migrationsExecuted).isZero();
    }
}
