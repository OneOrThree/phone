package com.oneorthree.phone.outbox.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

/** 운영 마이그레이션 배선은 컨텍스트마다 마이그레이션을 마친 별도 database 를 준다 (GROMO-1792). */
class OutboxTestPostgresIsolationTest {

    @Test
    @DisplayName("두 컨텍스트의 배선은 서로 다른 DB 이고, 둘 다 운영 스키마를 갖고, 한쪽 행이 다른 쪽에 보이지 않는다")
    void eachWiringGetsItsOwnMigratedDatabase() {
        JdbcTemplate first = wire();
        JdbcTemplate second = wire();

        assertThat(first.queryForObject("SELECT current_database()", String.class))
                .isNotEqualTo(second.queryForObject("SELECT current_database()", String.class));
        Integer migrations = first.queryForObject("SELECT count(*) FROM flyway_schema_history", Integer.class);
        assertThat(migrations).isPositive();
        assertThat(second.queryForObject("SELECT count(*) FROM flyway_schema_history", Integer.class))
                .isEqualTo(migrations);

        first.update("INSERT INTO aggregate_versions (aggregate_type, aggregate_id, last_version, updated_at)"
                + " VALUES ('USER', ?, 0, now())", UUID.randomUUID().toString());
        assertThat(first.queryForObject("SELECT count(*) FROM aggregate_versions", Integer.class)).isEqualTo(1);
        assertThat(second.queryForObject("SELECT count(*) FROM aggregate_versions", Integer.class)).isZero();
    }

    private static JdbcTemplate wire() {
        Map<String, Supplier<Object>> properties = new HashMap<>();
        OutboxTestPostgres.applyProductionMigrationWiring(properties::put);
        return new JdbcTemplate(new DriverManagerDataSource(
                (String) properties.get("spring.datasource.url").get(),
                (String) properties.get("spring.datasource.username").get(),
                (String) properties.get("spring.datasource.password").get()));
    }
}
