package com.oneorthree.notification;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 V9.1 DB와 정규 Flyway V15 사이의 원장·스키마·실패 원자성을 검증한다. */
@Testcontainers
class NotificationReleaseBridgeTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    DriverManagerDataSource source;
    JdbcTemplate jdbc;
    String backupHash;

    @BeforeEach
    void database() throws Exception {
        source = new DriverManagerDataSource(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword());
        jdbc = new JdbcTemplate(source);
        jdbc.execute("DROP SCHEMA IF EXISTS notification_release_bridge CASCADE; DROP SCHEMA public CASCADE;"
                + "CREATE SCHEMA public; ALTER DATABASE test SET gromo.environment='prod';"
                + "ALTER DATABASE test SET gromo.fcm_project_id='contract-prod'");
        Flyway.configure().dataSource(source).target("9").load().migrate();
        jdbc.execute(NotificationReleaseBridge.resource("/db/release-bridge/V9_1__backoffice_publications.sql"));
        jdbc.update("INSERT INTO flyway_schema_history(installed_rank,version,description,type,script,checksum,"
                + "installed_by,execution_time,success) VALUES(10,'9.1','backoffice publications','SQL',"
                + "'V9_1__backoffice_publications.sql',2017939251,current_user,0,true)");
        var result = PG.execInContainer("pg_dump", "-U", PG.getUsername(), "-Fc", "-f", "/tmp/bridge.dump", "test");
        assertThat(result.getExitCode()).isZero();
        Path backup = Files.createTempFile("notification-bridge", ".dump");
        PG.copyFileFromContainer("/tmp/bridge.dump", backup.toString());
        backupHash = NotificationReleaseBridge.sha256(Files.readAllBytes(backup));
        NotificationReleaseBridge.verifyBackup(backup, backupHash);
        Files.delete(backup);
    }

    @Test
    void referenceSchemasComeFromOriginalMigrations() throws Exception {
        // 갱신 출력은 build 아래에만 쓴다. 제품 manifest를 테스트가 자동 갱신하지 않는다.
        Path output = Path.of("build/bridge-reference");
        Files.createDirectories(output);
        try (Connection connection = source.getConnection()) {
            Files.writeString(output.resolve("source-schema.txt"), NotificationReleaseBridge.schema(connection));
        }
        jdbc.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
        // 전환기의 target 은 정규 V15 까지다. 그 뒤 migration(V16 이후)은 전환 후 일반 Flyway 가 적용한다.
        Flyway.configure().dataSource(source).target("15").load().migrate();
        try (Connection connection = source.getConnection()) {
            Files.writeString(output.resolve("target-schema.txt"), NotificationReleaseBridge.schema(connection));
        }
        assertThat(Files.readString(output.resolve("source-schema.txt")))
                .isEqualTo(NotificationReleaseBridge.resource("/db/release-bridge/source-schema.txt"));
        assertThat(Files.readString(output.resolve("target-schema.txt")))
                .isEqualTo(NotificationReleaseBridge.resource("/db/release-bridge/target-schema.txt"));
    }

    @Test
    void bridgePreservesReviewedStateAndCanonicalFlywayValidatesAndReruns() throws Exception {
        jdbc.update("UPDATE kinds SET enabled=false,quiet_policy='BYPASS',cooldown_seconds=321,"
                + "eligibility_required=true WHERE id='ADMIN_ANNOUNCEMENT'");
        jdbc.update("INSERT INTO templates(id,kind,locale,body) VALUES('admin.ko','ADMIN_ANNOUNCEMENT','ko','승인')");
        for (String state : List.of("PENDING", "DEFERRED", "SENT", "FAILED", "SUPPRESSED")) {
            jdbc.update("INSERT INTO deliveries(id,event_id,user_id,kind,payload,reviewed_push,status,last_error,"
                    + "lease_token,lease_expires_at,attempts) VALUES(?,?,?,'ADMIN_ANNOUNCEMENT','{}',"
                    + "'{\"body\":\"승인 원문\"}',?,'기존 사유',?,now()+interval '1 hour',4)",
                    UUID.randomUUID(), state, UUID.randomUUID(), state, UUID.randomUUID());
        }
        var kind = jdbc.queryForList("SELECT * FROM kinds WHERE id='ADMIN_ANNOUNCEMENT'");
        var templates = jdbc.queryForList("SELECT * FROM templates WHERE kind='ADMIN_ANNOUNCEMENT'");
        var deliveries = jdbc.queryForList("SELECT * FROM deliveries ORDER BY event_id");
        var history = jdbc.queryForList("SELECT * FROM flyway_schema_history WHERE version<>'9.1' ORDER BY installed_rank");
        apply();
        assertThat(jdbc.queryForList("SELECT * FROM kinds WHERE id='ADMIN_ANNOUNCEMENT'")).isEqualTo(kind);
        assertThat(jdbc.queryForList("SELECT * FROM templates WHERE kind='ADMIN_ANNOUNCEMENT'")).isEqualTo(templates);
        assertThat(jdbc.queryForList("SELECT * FROM deliveries ORDER BY event_id")).isEqualTo(deliveries);
        assertThat(jdbc.queryForList("SELECT * FROM flyway_schema_history WHERE installed_rank<=9 ORDER BY installed_rank"))
                .isEqualTo(history);
        Flyway flyway = Flyway.configure().dataSource(source).target("15").load();
        flyway.validate();
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        apply();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM notification_release_bridge.receipt", Integer.class))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT jsonb_array_length(source_history)"
                + " FROM notification_release_bridge.receipt", Integer.class)).isEqualTo(10);
    }

    @Test
    void unknownChecksumAndSchemaFailWithoutChangingHistory() throws Exception {
        jdbc.update("UPDATE flyway_schema_history SET checksum=0 WHERE version='9.1'");
        assertThatThrownBy(this::apply).hasMessageContaining("Flyway 이력");
        jdbc.update("UPDATE flyway_schema_history SET checksum=2017939251 WHERE version='9.1'");
        jdbc.execute("ALTER TABLE deliveries ADD COLUMN unexpected text");
        assertThatThrownBy(this::apply).hasMessageContaining("스키마 구조");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history", Integer.class)).isEqualTo(10);
        assertThat(jdbc.queryForObject("SELECT to_regclass('notification_release_bridge.receipt') IS NULL", Boolean.class))
                .isTrue();
    }

    @Test
    void canonicalSqlFailureRollsBackAllEarlierDdlAndHistory() throws Exception {
        // V10 자체의 PK 충돌을 이용한다. 테스트 전용 실패 주입 분기를 제품에 두지 않는다.
        jdbc.update("INSERT INTO jobs(id,owner,cron) VALUES('delivery-dispatch','NOTIFICATION','* * * * * *')");
        assertThatThrownBy(this::apply).isInstanceOf(java.sql.SQLException.class);
        assertThat(jdbc.queryForObject("SELECT enabled FROM kinds WHERE id='LEAGUE_WEEKLY_RESULT'", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("SELECT to_regclass('result_ack')::text", String.class)).isEqualTo("result_ack");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history", Integer.class)).isEqualTo(10);
        assertThat(jdbc.queryForObject("SELECT to_regclass('notification_release_bridge.receipt') IS NULL", Boolean.class))
                .isTrue();
    }

    @Test
    void activeClientOrWrongEnvironmentRejectsBeforeChanges() throws Exception {
        try (Connection other = source.getConnection()) {
            assertThat(other.isClosed()).isFalse();
            assertThatThrownBy(this::apply).hasMessageContaining("다른 DB 연결");
        }
        jdbc.execute("ALTER DATABASE test SET gromo.environment='dev'");
        assertThatThrownBy(this::apply).hasMessageContaining("표식");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history", Integer.class)).isEqualTo(10);
    }

    private void apply() throws Exception {
        try (Connection connection = source.getConnection()) {
            NotificationReleaseBridge.migrate(connection, "test", "prod", "contract-prod", backupHash);
        }
    }
}
