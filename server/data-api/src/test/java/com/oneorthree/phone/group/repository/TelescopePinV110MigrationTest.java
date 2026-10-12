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

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V110 망원경 핀 테이블의 실 SQL 검증 (GROMO-2268). 검증 방식은 {@code LoginAttemptV101MigrationTest} 선례 — 전용
 * 컨테이너에 Flyway 체인을 실제로 돌린다.
 *
 * <p>보는 것: ① 열 타입·nullability, PK 순서(사람, 섬), 두 FK 의 연쇄 삭제, CHECK(출처 둘뿐), 정렬 인덱스, ② V109 까지 올린
 * 스키마(기존 사람·섬이 있다) 위에 V110 이 적용되고 표는 빈 채로 시작한다(백필 없음), 같은 (사람, 섬) 두 번째 INSERT 는
 * {@code ON CONFLICT DO NOTHING} 이 0행으로 흘려 첫 값이 남는다, ③ 빈 DB 의 전체 경로.
 *
 * <p>구조 단언은 V110 으로 고정해(target) 뒤 번호 마이그레이션이 이 표를 만져도 흔들리지 않게 한다.
 */
class TelescopePinV110MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다. */
    private static final PostgreSQLContainer<?> POSTGRES;

    private static final String INSERT = "INSERT INTO telescope_pins (user_id, island_id, source, pinned_at, expires_at) "
            + "VALUES (?, ?, ?, TIMESTAMPTZ '2034-05-05 05:00:00+00', TIMESTAMPTZ '2034-05-05 22:00:00+00')";

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
    @DisplayName("열 타입·nullability, PK 순서(사람, 섬), 두 FK 의 연쇄 삭제, 출처 CHECK, 정렬 인덱스가 정확히 생긴다")
    void tableShape() {
        migrate(MigrationVersion.fromVersion("110"));
        JdbcTemplate jdbc = jdbc();

        List<Map<String, Object>> rows = jdbc.queryForList("SELECT column_name, data_type, is_nullable, "
                + "character_maximum_length FROM information_schema.columns WHERE table_name = 'telescope_pins'");
        assertThat(rows).hasSize(5);
        Map<String, Map<String, Object>> columns = new HashMap<>();
        rows.forEach(row -> columns.put((String) row.get("column_name"), row));

        assertColumn(columns.get("user_id"), "uuid");
        assertColumn(columns.get("island_id"), "uuid");
        assertColumn(columns.get("source"), "character varying");
        assertThat(columns.get("source")).containsEntry("character_maximum_length", 20);
        assertColumn(columns.get("pinned_at"), "timestamp with time zone");
        assertColumn(columns.get("expires_at"), "timestamp with time zone");

        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.key_column_usage "
                + "WHERE table_name = 'telescope_pins' AND constraint_name = 'telescope_pins_pkey' "
                + "ORDER BY ordinal_position", String.class)).containsExactly("user_id", "island_id");
        // FK 둘 다 ON DELETE CASCADE ('c') — 하나는 users, 하나는 groups.
        assertThat(jdbc.queryForList("SELECT confrelid::regclass::text || ':' || confdeltype::text FROM pg_constraint "
                + "WHERE conrelid = 'telescope_pins'::regclass AND contype = 'f' ORDER BY 1", String.class))
                .containsExactly("groups:c", "users:c");
        assertThat(jdbc.queryForObject("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                + "WHERE conrelid = 'telescope_pins'::regclass AND contype = 'c'", String.class))
                .contains("magazine").contains("observatory");
        assertThat(jdbc.queryForObject("SELECT indexdef FROM pg_indexes "
                + "WHERE indexname = 'telescope_pins_user_pinned_idx'", String.class))
                .contains("(user_id, pinned_at)");
    }

    @Test
    @DisplayName("V109 의 기존 사람·섬 위에 V110 이 적용되고 표는 비어 있다 — 출처는 둘뿐이고 같은 핀은 한 번만 들어가며 섬·사람이 지워지면 함께 지워진다")
    void startsEmptyAndGuardsTheRows() {
        migrate(MigrationVersion.fromVersion("109"));
        JdbcTemplate jdbc = jdbc();
        UUID userId = user(jdbc);
        UUID islandId = island(jdbc);

        migrate(MigrationVersion.fromVersion("110"));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM telescope_pins", Integer.class))
                .as("백필이 없다 — 핀은 사람이 직접 넣는다").isZero();

        assertThat(jdbc.update(INSERT, userId, islandId, "magazine")).isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update(INSERT, userId, islandId, "observatory"))
                .as("PK (사람, 섬) — 같은 핀은 두 번 들어가지 않는다").isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.update("INSERT INTO telescope_pins (user_id, island_id, source, pinned_at, expires_at) "
                + "VALUES (?, ?, 'observatory', now(), now()) ON CONFLICT (user_id, island_id) DO NOTHING",
                userId, islandId)).as("멱등 가드 — 0행이고 첫 값이 남는다").isZero();
        assertThat(jdbc.queryForObject("SELECT source FROM telescope_pins WHERE user_id = ?", String.class, userId))
                .isEqualTo("magazine");

        UUID otherIsland = island(jdbc);
        assertThatThrownBy(() -> jdbc.update(INSERT, userId, otherIsland, "ad"))
                .as("출처 CHECK").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT, userId, UUID.randomUUID(), "magazine"))
                .as("없는 섬 FK").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT, UUID.randomUUID(), otherIsland, "magazine"))
                .as("없는 사람 FK").isInstanceOf(DataIntegrityViolationException.class);

        jdbc.update(INSERT, userId, otherIsland, "observatory");
        jdbc.update("DELETE FROM groups WHERE id = ?", islandId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM telescope_pins WHERE island_id = ?", Integer.class,
                islandId)).as("섬이 지워지면 그 섬의 핀도").isZero();
        jdbc.update("DELETE FROM users WHERE id = ?", userId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM telescope_pins", Integer.class))
                .as("사람이 지워지면 그 사람의 핀도").isZero();
    }

    @Test
    @DisplayName("빈 DB 의 전체 마이그레이션 경로에서도 V110 이 성공으로 기록된다")
    void appliesOnEmptyDatabase() {
        migrate(MigrationVersion.LATEST);

        assertThat(jdbc().queryForObject("SELECT success::text FROM flyway_schema_history WHERE version = '110'",
                String.class)).isEqualTo("true");
    }

    private static void assertColumn(Map<String, Object> column, String type) {
        assertThat(column).isNotNull();
        assertThat(column.get("data_type")).isEqualTo(type);
        assertThat(column.get("is_nullable")).as("모든 열이 NOT NULL").isEqualTo("NO");
    }

    private static UUID user(JdbcTemplate jdbc) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, created_at, is_guest, nickname, is_deleted) "
                + "VALUES (?, now(), false, ?, false)", id, "핀-" + id);
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
