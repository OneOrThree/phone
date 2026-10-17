package com.oneorthree.phone.group.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V125 망원경 1시간 스냅샷 표·핀 만료 줄이기의 실 SQL 검증 (GROMO-2306). 검증 방식은 {@link TelescopePinV115MigrationTest}
 * 선례 — 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 *
 * <p>보는 것: ① 열 타입·nullability·기본값, PK 순서(사람, 버킷), users FK 의 연쇄 삭제, ② V124 까지 올린 스키마의 기존 핀이
 * V125 뒤에 «넣은 정시 + 1시간» 으로 줄어들고(07:00 KST 만료였던 행), 이미 그보다 이른 만료는 그대로다, 같은 (사람, 버킷)
 * 두 번째 INSERT 는 {@code ON CONFLICT DO NOTHING} 이 0행으로 흘려 첫 값이 남는다, ③ 빈 DB 의 전체 경로.
 *
 * <p>구조 단언은 V125 로 고정해(target) 뒤 번호 마이그레이션이 이 표를 만져도 흔들리지 않게 한다.
 */
class TelescopeBucketsV125MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다. */
    private static final PostgreSQLContainer<?> POSTGRES;

    private static final String INSERT_BUCKET = "INSERT INTO telescope_buckets (user_id, bucket_start, island_ids, "
            + "has_nearby) VALUES (?, TIMESTAMPTZ '2034-05-05 05:00:00+00', CAST(? AS uuid[]), ?) "
            + "ON CONFLICT (user_id, bucket_start) DO NOTHING";

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbc = jdbc();
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
    }

    @Test
    @DisplayName("열 타입·nullability·기본값, PK 순서(사람, 버킷), users FK 의 연쇄 삭제가 정확히 생긴다")
    void tableShape() {
        migrate(MigrationVersion.fromVersion("125"));
        JdbcTemplate jdbc = jdbc();

        List<Map<String, Object>> rows = jdbc.queryForList("SELECT column_name, data_type, udt_name, is_nullable, "
                + "column_default FROM information_schema.columns WHERE table_name = 'telescope_buckets'");
        assertThat(rows).hasSize(5);
        Map<String, Map<String, Object>> columns = new HashMap<>();
        rows.forEach(row -> columns.put((String) row.get("column_name"), row));

        assertColumn(columns.get("user_id"), "uuid");
        assertColumn(columns.get("bucket_start"), "timestamp with time zone");
        assertColumn(columns.get("island_ids"), "ARRAY");
        assertThat(columns.get("island_ids")).containsEntry("udt_name", "_uuid");
        assertColumn(columns.get("has_nearby"), "boolean");
        assertColumn(columns.get("created_at"), "timestamp with time zone");
        assertThat((String) columns.get("created_at").get("column_default")).contains("now()");

        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.key_column_usage "
                + "WHERE table_name = 'telescope_buckets' AND constraint_name = 'telescope_buckets_pkey' "
                + "ORDER BY ordinal_position", String.class)).containsExactly("user_id", "bucket_start");
        assertThat(jdbc.queryForList("SELECT confrelid::regclass::text || ':' || confdeltype::text FROM pg_constraint "
                + "WHERE conrelid = 'telescope_buckets'::regclass AND contype = 'f'", String.class))
                .containsExactly("users:c");
        assertThat(jdbc.queryForObject("SELECT obj_description('telescope_buckets'::regclass, 'pg_class')",
                String.class)).contains("GROMO-2306");
    }

    @Test
    @DisplayName("V124 의 기존 핀은 V125 뒤 «넣은 정시 + 1시간» 으로 줄고 더 이른 만료는 그대로다 — 스냅샷은 (사람, 버킷)에 한 행이고 "
            + "사람이 지워지면 함께 지워진다")
    void shortensPinsAndGuardsTheRows() {
        migrate(MigrationVersion.fromVersion("124"));
        JdbcTemplate jdbc = jdbc();
        UUID userId = user(jdbc);
        UUID sevenKst = island(jdbc);
        UUID alreadyEarly = island(jdbc);
        // 05:23:41Z 에 넣은 핀 — V115 규칙의 만료는 다음 07:00 KST(22:00Z)다.
        pin(jdbc, userId, sevenKst, "2034-05-05 05:23:41+00", "2034-05-05 22:00:00+00");
        // 만료가 이미 «넣은 정시 + 1시간» 보다 이르면 늦추지 않는다(LEAST).
        pin(jdbc, userId, alreadyEarly, "2034-05-05 05:10:00+00", "2034-05-05 05:30:00+00");

        migrate(MigrationVersion.fromVersion("125"));

        assertThat(expiresAt(jdbc, userId, sevenKst)).isEqualTo(Instant.parse("2034-05-05T06:00:00Z"));
        assertThat(expiresAt(jdbc, userId, alreadyEarly)).isEqualTo(Instant.parse("2034-05-05T05:30:00Z"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM telescope_buckets", Integer.class))
                .as("백필이 없다 — 스냅샷은 목록 요청이 넣는다").isZero();

        UUID first = UUID.randomUUID();
        assertThat(jdbc.update(INSERT_BUCKET, userId, "{" + first + "," + UUID.randomUUID() + "}", true)).isEqualTo(1);
        assertThat(jdbc.update(INSERT_BUCKET, userId, "{}", false)).as("멱등 가드 — 0행이고 첫 값이 남는다").isZero();
        assertThat(jdbc.queryForObject("SELECT (island_ids[1])::text FROM telescope_buckets WHERE user_id = ?",
                String.class, userId)).isEqualTo(first.toString());
        assertThatThrownBy(() -> jdbc.update(INSERT_BUCKET, UUID.randomUUID(), "{}", false))
                .as("없는 사람 FK").isInstanceOf(DataIntegrityViolationException.class);

        jdbc.update("DELETE FROM telescope_pins WHERE user_id = ?", userId);
        jdbc.update("DELETE FROM users WHERE id = ?", userId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM telescope_buckets", Integer.class))
                .as("사람이 지워지면 그 사람의 스냅샷도").isZero();
    }

    @Test
    @DisplayName("빈 DB 의 전체 마이그레이션 경로에서도 V125 가 성공으로 기록된다")
    void appliesOnEmptyDatabase() {
        migrate(MigrationVersion.LATEST);

        assertThat(jdbc().queryForObject("SELECT success::text FROM flyway_schema_history WHERE version = '125'",
                String.class)).isEqualTo("true");
    }

    private static void assertColumn(Map<String, Object> column, String type) {
        assertThat(column).isNotNull();
        assertThat(column.get("data_type")).isEqualTo(type);
        assertThat(column.get("is_nullable")).as("모든 열이 NOT NULL").isEqualTo("NO");
    }

    private static Instant expiresAt(JdbcTemplate jdbc, UUID userId, UUID islandId) {
        return jdbc.queryForObject("SELECT expires_at FROM telescope_pins WHERE user_id = ? AND island_id = ?",
                Timestamp.class, userId, islandId).toInstant();
    }

    private static void pin(JdbcTemplate jdbc, UUID userId, UUID islandId, String pinnedAt, String expiresAt) {
        jdbc.update("INSERT INTO telescope_pins (user_id, island_id, source, pinned_at, expires_at) "
                + "VALUES (?, ?, 'magazine', CAST(? AS timestamptz), CAST(? AS timestamptz))",
                userId, islandId, pinnedAt, expiresAt);
    }

    private static UUID user(JdbcTemplate jdbc) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, created_at, is_guest, nickname, is_deleted) "
                + "VALUES (?, now(), false, ?, false)", id, "버킷-" + id);
        return id;
    }

    private static UUID island(JdbcTemplate jdbc) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '옛섬', 10, true, 'OWNER_ONLY', 'WAITING')", id);
        return id;
    }

    private void migrate(MigrationVersion target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}
