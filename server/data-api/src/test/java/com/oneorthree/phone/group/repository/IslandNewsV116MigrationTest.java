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
 * V116 섬 소식 테이블의 실 SQL 검증 (GROMO-2267). 검증 방식은 {@code LoginAttemptV101MigrationTest} 선례 — 전용
 * 컨테이너에 Flyway 체인을 실제로 돌린다.
 *
 * <p>보는 것: ① 열 타입·길이·nullability·default, PK, FK 연쇄 삭제, 최근순 인덱스, ② V114 까지 올린 스키마(기존 섬이
 * 있다) 위에 V116 이 적용되고 표는 빈 채로 시작한다(백필 없음), ③ kind 에 CHECK 가 없어 다음 종류가 들어오고 길이 상한은
 * DB 가 지킨다, ④ 빈 DB 의 전체 경로.
 *
 * <p>구조 단언은 V116 로 고정해(target) 뒤 번호 마이그레이션이 이 표를 만져도 흔들리지 않게 한다. 번호 사이(V115)가
 * 비어 있어도 Flyway 는 개의치 않는다.
 */
class IslandNewsV116MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다. */
    private static final PostgreSQLContainer<?> POSTGRES;

    private static final String INSERT_NEWS = "INSERT INTO island_news (id, island_id, kind, body) VALUES (?, ?, ?, ?)";

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
    @DisplayName("열 타입·길이·nullability·default, PK, FK 연쇄 삭제, 최근순 인덱스가 정확히 생긴다")
    void tableShape() {
        migrate(MigrationVersion.fromVersion("116"));
        JdbcTemplate jdbc = jdbc();

        List<Map<String, Object>> rows = jdbc.queryForList("SELECT column_name, data_type, is_nullable, "
                + "column_default, character_maximum_length FROM information_schema.columns "
                + "WHERE table_name = 'island_news'");
        assertThat(rows).hasSize(5);
        Map<String, Map<String, Object>> columns = new HashMap<>();
        rows.forEach(row -> columns.put((String) row.get("column_name"), row));

        assertColumn(columns.get("id"), "uuid", "NO");
        assertColumn(columns.get("island_id"), "uuid", "NO");
        assertColumn(columns.get("kind"), "character varying", "NO");
        assertThat(columns.get("kind")).containsEntry("character_maximum_length", 20);
        assertColumn(columns.get("body"), "character varying", "NO");
        assertThat(columns.get("body")).containsEntry("character_maximum_length", 200);
        assertColumn(columns.get("created_at"), "timestamp with time zone", "NO");
        assertThat((String) columns.get("created_at").get("column_default")).contains("now()");

        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.key_column_usage "
                + "WHERE table_name = 'island_news' AND constraint_name = 'island_news_pkey'", String.class))
                .containsExactly("id");
        // FK 는 groups 하나, ON DELETE CASCADE ('c').
        assertThat(jdbc.queryForList("SELECT confdeltype::text FROM pg_constraint "
                + "WHERE conrelid = 'island_news'::regclass AND contype = 'f'", String.class))
                .containsExactly("c");
        assertThat(jdbc.queryForObject("SELECT indexdef FROM pg_indexes "
                + "WHERE indexname = 'island_news_island_created_idx'", String.class))
                .contains("(island_id, created_at DESC)");
    }

    @Test
    @DisplayName("V114 의 기존 섬 위에 V116 이 적용되고 표는 비어 있다 — 새 종류도 받고, 길이 상한은 DB 가 지키고, 섬이 지워지면 함께 지워진다")
    void startsEmptyAcceptsNewKindsAndCascades() {
        migrate(MigrationVersion.fromVersion("114"));
        JdbcTemplate jdbc = jdbc();
        UUID islandId = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '옛섬', 10, true, 'OWNER_ONLY', 'WAITING')", islandId);

        migrate(MigrationVersion.fromVersion("116"));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_news", Integer.class))
                .as("백필이 없다 — 소식은 홍보 신청이 쓴다").isZero();

        jdbc.update(INSERT_NEWS, UUID.randomUUID(), islandId, "PROMOTION", "섬장이 오늘 잡지 홍보에 60마리를 썼어요");
        // kind 에 CHECK 가 없다 — 다음 종류가 마이그레이션 없이 들어온다.
        jdbc.update(INSERT_NEWS, UUID.randomUUID(), islandId, "MAGAZINE_ISSUED", "새 호가 나왔어요");
        assertThat(jdbc.queryForObject("SELECT created_at IS NOT NULL FROM island_news WHERE kind = 'PROMOTION'",
                Boolean.class)).as("created_at default now()").isTrue();

        assertThatThrownBy(() -> jdbc.update(INSERT_NEWS, UUID.randomUUID(), islandId, "K".repeat(21), "본문"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT_NEWS, UUID.randomUUID(), islandId, "PROMOTION", "가".repeat(201)))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_news", Integer.class)).isEqualTo(2);

        jdbc.update("DELETE FROM groups WHERE id = ?", islandId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_news", Integer.class)).isZero();
    }

    @Test
    @DisplayName("빈 DB 의 전체 마이그레이션 경로에서도 V116 이 성공으로 기록된다")
    void appliesOnEmptyDatabase() {
        migrate(MigrationVersion.LATEST);

        assertThat(jdbc().queryForObject("SELECT success::text FROM flyway_schema_history WHERE version = '111'",
                String.class)).isEqualTo("true");
    }

    private static void assertColumn(Map<String, Object> column, String type, String nullable) {
        assertThat(column).isNotNull();
        assertThat(column.get("data_type")).isEqualTo(type);
        assertThat(column.get("is_nullable")).isEqualTo(nullable);
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
