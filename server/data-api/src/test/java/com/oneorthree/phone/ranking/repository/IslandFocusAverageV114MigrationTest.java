package com.oneorthree.phone.ranking.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V114 섬별 7일 평균 스냅샷 테이블의 실 SQL 검증 (GROMO-2257). 검증 방식은 {@code LoginAttemptV101MigrationTest}
 * 선례 — 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 *
 * <p>보는 것: ① 열 타입·nullability·default, PK 순서, FK 연쇄 삭제, 최근순 인덱스, ② V113 까지 올린 스키마(기존
 * 섬이 있다) 위에 V114 가 적용되고 표는 빈 채로 시작한다(백필 없음 — 값은 07시 배치의 몫), ③ 같은 (날짜, 섬)
 * 두 번째 INSERT 는 {@code ON CONFLICT DO NOTHING} 이 0행으로 흘려 첫 값이 남는다, ④ 빈 DB 의 전체 경로.
 *
 * <p>구조 단언은 V114 로 고정해(target) 뒤 번호 마이그레이션이 이 표를 만져도 흔들리지 않게 한다.
 */
class IslandFocusAverageV114MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다. */
    private static final PostgreSQLContainer<?> POSTGRES;

    private static final String INSERT_IF_ABSENT = "INSERT INTO island_focus_averages "
            + "(snapshot_date, island_id, member_count, avg_minutes_per_member_day) "
            + "VALUES (DATE '2034-05-05', ?, ?, ?) ON CONFLICT (snapshot_date, island_id) DO NOTHING";

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
    @DisplayName("열 타입·nullability·default, PK 순서(날짜, 섬), FK 연쇄 삭제, 최근순 인덱스가 정확히 생긴다")
    void tableShape() {
        migrate(MigrationVersion.fromVersion("114"));
        JdbcTemplate jdbc = jdbc();

        List<Map<String, Object>> rows = jdbc.queryForList("SELECT column_name, data_type, is_nullable, column_default "
                + "FROM information_schema.columns WHERE table_name = 'island_focus_averages'");
        assertThat(rows).hasSize(5);
        Map<String, Map<String, Object>> columns = new HashMap<>();
        rows.forEach(row -> columns.put((String) row.get("column_name"), row));

        assertColumn(columns.get("snapshot_date"), "date", "NO");
        assertColumn(columns.get("island_id"), "uuid", "NO");
        assertColumn(columns.get("member_count"), "integer", "NO");
        // 평균만 nullable — NULL 이 «주민 0명» 이라는 뜻이다. 0(집중 없음)과 섞이지 않는다.
        assertColumn(columns.get("avg_minutes_per_member_day"), "integer", "YES");
        assertColumn(columns.get("computed_at"), "timestamp with time zone", "NO");
        assertThat((String) columns.get("computed_at").get("column_default")).contains("now()");

        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.key_column_usage "
                + "WHERE table_name = 'island_focus_averages' AND constraint_name = 'island_focus_averages_pkey' "
                + "ORDER BY ordinal_position", String.class)).containsExactly("snapshot_date", "island_id");
        // FK 는 groups 하나, ON DELETE CASCADE ('c').
        assertThat(jdbc.queryForList("SELECT confdeltype::text FROM pg_constraint "
                + "WHERE conrelid = 'island_focus_averages'::regclass AND contype = 'f'", String.class))
                .containsExactly("c");
        assertThat(jdbc.queryForObject("SELECT indexdef FROM pg_indexes "
                + "WHERE indexname = 'island_focus_averages_island_date_idx'", String.class))
                .contains("(island_id, snapshot_date DESC)");
    }

    @Test
    @DisplayName("V113 의 기존 섬 위에 V114 가 적용되고 표는 비어 있다 — 두 번째 INSERT 는 첫 값을 덮지 않고 섬이 지워지면 함께 지워진다")
    void startsEmptyAndKeepsTheFirstValue() {
        migrate(MigrationVersion.fromVersion("113"));
        JdbcTemplate jdbc = jdbc();
        UUID islandId = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '옛섬', 10, true, 'OWNER_ONLY', 'WAITING')", islandId);

        migrate(MigrationVersion.fromVersion("114"));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_focus_averages", Integer.class))
                .as("백필이 없다 — 값은 07시 배치가 적는다").isZero();

        assertThat(jdbc.update(INSERT_IF_ABSENT, islandId, 2, 60)).isEqualTo(1);
        assertThat(jdbc.update(INSERT_IF_ABSENT, islandId, 5, 999))
                .as("같은 (날짜, 섬) 은 0행 — 멱등 가드").isZero();
        Map<String, Object> kept = jdbc.queryForMap("SELECT member_count, avg_minutes_per_member_day "
                + "FROM island_focus_averages WHERE island_id = ?", islandId);
        assertThat(kept).containsEntry("member_count", 2).containsEntry("avg_minutes_per_member_day", 60);

        // 주민 0명 행 — 평균 NULL 을 받아 준다.
        jdbc.update("INSERT INTO island_focus_averages (snapshot_date, island_id, member_count) "
                + "VALUES (DATE '2034-05-06', ?, 0)", islandId);
        assertThat(jdbc.queryForObject("SELECT avg_minutes_per_member_day FROM island_focus_averages "
                + "WHERE snapshot_date = DATE '2034-05-06' AND island_id = ?", Integer.class, islandId)).isNull();

        jdbc.update("DELETE FROM groups WHERE id = ?", islandId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_focus_averages", Integer.class)).isZero();
    }

    @Test
    @DisplayName("빈 DB 의 전체 마이그레이션 경로에서도 V114 가 성공으로 기록된다")
    void appliesOnEmptyDatabase() {
        migrate(MigrationVersion.LATEST);

        assertThat(jdbc().queryForObject("SELECT success::text FROM flyway_schema_history WHERE version = '109'",
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
