package com.oneorthree.phone.common.db;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Spring 서버 없이 실행하는 배포용 Flyway 진입점의 체인 선택·재실행 계약. */
class DeploymentMigrationMainTest {
    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16.14-alpine");
        POSTGRES.start();
    }

    private Map<String, String> environment;
    private JdbcTemplate jdbc;

    @BeforeEach
    void resetSchema() {
        environment = Map.of("API_DB_URL", POSTGRES.getJdbcUrl(), "API_DB_USERNAME", POSTGRES.getUsername(),
                "API_DB_PASSWORD", POSTGRES.getPassword());
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    void 신규_DB와_반복_배포는_V0_한_행과_기본데이터를_유지한다() {
        var configuration = DeploymentMigrationMain.configuration("current", environment);
        assertThat(configuration.isBaselineOnMigrate()).isFalse();
        assertThat(configuration.isCleanDisabled()).isTrue();
        assertThat(configuration.isOutOfOrder()).isFalse();
        assertThat(configuration.isGroup()).isTrue();
        configuration.load().migrate();
        jdbc.update("DELETE FROM audio_tracks");

        DeploymentMigrationMain.configuration("current", environment).load().migrate();

        // 반복 배포·기본데이터 콜백은 V0 체인에 이력 행을 더하지 않는다.
        assertThat(jdbc.queryForList("SELECT version FROM flyway_schema_history", String.class))
                .containsExactly("0", "1", "2", "3", "4", "5");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audio_tracks", Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items", Integer.class)).isEqualTo(110);
    }

    @Test
    void 원본_이력은_보존한_채_V117에서_V138까지만_준비한다() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").target("117").load().migrate();

        DeploymentMigrationMain.configuration("legacy", environment).load().migrate();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history", Integer.class)).isEqualTo(126);
        assertThat(jdbc.queryForObject("SELECT version FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1",
                String.class)).isEqualTo("138");
        assertThat(jdbc.queryForObject("SELECT to_regclass('public.groups') IS NOT NULL", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items", Integer.class)).isEqualTo(110);
    }

    @Test
    void 묶음_이행이_실패하면_선행_DDL도_롤백되고_빈_이력만_남는다(@TempDir Path directory) throws Exception {
        Files.writeString(directory.resolve("V0__create.sql"), "CREATE TABLE rollback_probe(id integer);");
        Files.writeString(directory.resolve("V1__fail.sql"), "SELECT * FROM nonexistent_deployment_table;");

        assertThatThrownBy(() -> DeploymentMigrationMain.configuration("current", environment)
                .locations("filesystem:" + directory).load().migrate()).isInstanceOf(FlywayException.class);

        assertThat(jdbc.queryForObject("SELECT to_regclass('public.rollback_probe') IS NULL", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_indexes WHERE tablename='flyway_schema_history'",
                Integer.class)).isEqualTo(2);
    }

    @Test
    void 실행_모드와_DB_자격증명이_명시되지_않으면_거부한다() {
        assertThatThrownBy(() -> DeploymentMigrationMain.configuration("repair", environment))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> DeploymentMigrationMain.configuration("current", Map.of()))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("API_DB_URL");
        assertThatThrownBy(() -> DeploymentMigrationMain.main(new String[0]))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
