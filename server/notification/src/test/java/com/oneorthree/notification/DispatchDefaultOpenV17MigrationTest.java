package com.oneorthree.notification;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class DispatchDefaultOpenV17MigrationTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");

    @BeforeEach
    void clean() {
        flyway(MigrationVersion.LATEST).clean();
    }

    @Test
    void opensOnlyAnEmptyNewStore() {
        flyway(MigrationVersion.LATEST).migrate();
        JdbcTemplate jdbc = jdbc();

        assertThat(gate(jdbc)).containsEntry("enabled", true).containsEntry("ever_opened", true);
        assertThat(jdbc.queryForObject("SELECT column_default FROM information_schema.columns"
                + " WHERE table_name='dispatch_control' AND column_name='enabled'", String.class))
                .isEqualTo("true");
    }

    @Test
    void keepsAnUnopenedStoreWithExistingRecipientsClosed() {
        flyway(MigrationVersion.fromVersion("16")).migrate();
        JdbcTemplate jdbc = jdbc();
        jdbc.update("INSERT INTO device_tokens(device_token,user_id,ownership_token) VALUES(?,?,?)",
                "existing-token", UUID.randomUUID(), UUID.randomUUID());

        flyway(MigrationVersion.LATEST).migrate();

        assertThat(gate(jdbc)).containsEntry("enabled", false).containsEntry("ever_opened", false);
    }

    @Test
    void preservesAnIntentionalClose() {
        flyway(MigrationVersion.fromVersion("16")).migrate();
        JdbcTemplate jdbc = jdbc();
        jdbc.update("UPDATE dispatch_control SET ever_opened=true,enabled=false WHERE id=1");

        flyway(MigrationVersion.LATEST).migrate();

        assertThat(gate(jdbc)).containsEntry("enabled", false).containsEntry("ever_opened", true);
    }

    private static Map<String, Object> gate(JdbcTemplate jdbc) {
        return jdbc.queryForMap("SELECT enabled,ever_opened FROM dispatch_control WHERE id=1");
    }

    private static JdbcTemplate jdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword()));
    }

    private static Flyway flyway(MigrationVersion target) {
        return Flyway.configure()
                .dataSource(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .cleanDisabled(false)
                .load();
    }
}
