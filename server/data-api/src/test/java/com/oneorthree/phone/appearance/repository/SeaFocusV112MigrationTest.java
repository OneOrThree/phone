package com.oneorthree.phone.appearance.repository;

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
 * V112 바다 집중 누적·단계표 테이블의 실 SQL 검증 (GROMO-2274). 검증 방식은 {@code LoginAttemptV101MigrationTest}
 * 선례 — 전용 컨테이너에 Flyway 체인을 실제로 돌린다.
 *
 * <p>보는 것: ① 열 타입·길이·nullability·default, PK, FK 동작, 유일 제약, CHECK, ② 기존 데이터(유저·카탈로그) 위에
 * 적용되고 두 표는 <b>빈 채로</b> 시작한다(시드 없음 — 바다 전용 상품이 아직 없다), ③ 제약이 DB 에서 실제로 걸린다,
 * ④ 빈 DB 의 전체 경로.
 *
 * <p>구조 단언은 V112 로 고정해(target) 뒤 번호 마이그레이션이 이 표를 만져도 흔들리지 않게 한다.
 */
class SeaFocusV112MigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다. */
    private static final PostgreSQLContainer<?> POSTGRES;

    private static final String INSERT_TOTAL = "INSERT INTO sea_focus_totals (user_id, month_key) VALUES (?, ?)";
    private static final String INSERT_TIER =
            "INSERT INTO sea_reward_tiers (set_key, threshold_minutes, product_id) VALUES (?, ?, ?)";

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
    @DisplayName("sea_focus_totals: 열 타입·길이·nullability·default, PK, users FK 연쇄 삭제가 정확히 생긴다")
    void totalsTableShape() {
        migrate(MigrationVersion.fromVersion("112"));
        JdbcTemplate jdbc = jdbc();

        Map<String, Map<String, Object>> columns = columnsOf(jdbc, "sea_focus_totals");
        assertThat(columns).hasSize(5);
        assertColumn(columns.get("user_id"), "uuid", "NO");
        assertColumn(columns.get("lifetime_seconds"), "bigint", "NO");
        assertThat((String) columns.get("lifetime_seconds").get("column_default")).isEqualTo("0");
        // 고정 7자 'YYYY-MM' — 가변 길이 문자열이 아니라 char(7) 이다(계약 §8).
        assertColumn(columns.get("month_key"), "character", "NO");
        assertThat(columns.get("month_key")).containsEntry("character_maximum_length", 7);
        assertColumn(columns.get("month_seconds"), "bigint", "NO");
        assertThat((String) columns.get("month_seconds").get("column_default")).isEqualTo("0");
        assertColumn(columns.get("updated_at"), "timestamp with time zone", "NO");
        assertThat((String) columns.get("updated_at").get("column_default")).contains("now()");

        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.key_column_usage "
                + "WHERE table_name = 'sea_focus_totals' AND constraint_name = 'sea_focus_totals_pkey'",
                String.class)).containsExactly("user_id");
        // FK 는 users 하나, ON DELETE CASCADE ('c').
        assertThat(jdbc.queryForList("SELECT confdeltype::text FROM pg_constraint "
                + "WHERE conrelid = 'sea_focus_totals'::regclass AND contype = 'f'", String.class))
                .containsExactly("c");
        assertThat(jdbc.queryForObject("SELECT confrelid::regclass::text FROM pg_constraint "
                + "WHERE conrelid = 'sea_focus_totals'::regclass AND contype = 'f'", String.class))
                .isEqualTo("users");
    }

    @Test
    @DisplayName("sea_reward_tiers: 열 타입·길이·nullability, PK, 카탈로그 FK, 유일 제약, CHECK 가 정확히 생긴다")
    void tiersTableShape() {
        migrate(MigrationVersion.fromVersion("112"));
        JdbcTemplate jdbc = jdbc();

        Map<String, Map<String, Object>> columns = columnsOf(jdbc, "sea_reward_tiers");
        assertThat(columns).hasSize(4);
        assertColumn(columns.get("id"), "bigint", "NO");
        assertThat((String) columns.get("id").get("column_default")).contains("nextval");
        assertColumn(columns.get("set_key"), "character varying", "NO");
        assertThat(columns.get("set_key")).containsEntry("character_maximum_length", 20);
        assertColumn(columns.get("threshold_minutes"), "integer", "NO");
        assertColumn(columns.get("product_id"), "character varying", "NO");
        // 참조하는 catalog_assets.product_id(80) 와 같은 폭이다 — 61~80자 상품 id 도 단계표에 넣을 수 있어야 한다.
        assertThat(columns.get("product_id")).containsEntry("character_maximum_length", 80);

        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.key_column_usage "
                + "WHERE table_name = 'sea_reward_tiers' AND constraint_name = 'sea_reward_tiers_pkey'",
                String.class)).containsExactly("id");
        // FK 는 catalog_assets 하나, 지우는 쪽은 막힌다(NO ACTION, 'a') — 카탈로그 행은 퇴역해도 남는다.
        assertThat(jdbc.queryForList("SELECT confdeltype::text FROM pg_constraint "
                + "WHERE conrelid = 'sea_reward_tiers'::regclass AND contype = 'f'", String.class))
                .containsExactly("a");
        assertThat(jdbc.queryForObject("SELECT confrelid::regclass::text FROM pg_constraint "
                + "WHERE conrelid = 'sea_reward_tiers'::regclass AND contype = 'f'", String.class))
                .isEqualTo("catalog_assets");
        assertThat(jdbc.queryForObject("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                + "WHERE conrelid = 'sea_reward_tiers'::regclass AND contype = 'u'", String.class))
                .isEqualTo("UNIQUE (set_key, threshold_minutes, product_id)");
        assertThat(jdbc.queryForObject("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                + "WHERE conrelid = 'sea_reward_tiers'::regclass AND contype = 'c'", String.class))
                .contains("threshold_minutes > 0");
    }

    @Test
    @DisplayName("기존 유저·카탈로그 위에 V112 가 적용되고 두 표는 비어 있다 — 시드가 없다")
    void startsEmptyOverExistingData() {
        migrate(MigrationVersion.fromVersion("111"));
        JdbcTemplate jdbc = jdbc();
        user(jdbc);
        product(jdbc, "scarf", "clothes", "user");

        migrate(MigrationVersion.fromVersion("112"));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM sea_focus_totals", Integer.class))
                .as("누적은 바다 집중이 끝날 때 서비스가 쓴다").isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sea_reward_tiers", Integer.class))
                .as("단계표는 운영이 SQL 로 넣는다 — 바다 전용 상품이 아직 없어 시드를 넣지 않는다").isZero();
    }

    @Test
    @DisplayName("제약이 DB 에서 걸린다 — 유저당 한 행, 같은 단계 중복·0분 이하·미등록 상품·긴 세트 키는 거부되고 연쇄 삭제는 돈다")
    void constraintsHold() {
        migrate(MigrationVersion.LATEST);
        JdbcTemplate jdbc = jdbc();
        UUID userId = user(jdbc);
        product(jdbc, "scarf", "clothes", "user");
        product(jdbc, "hat", "decor", "user");

        jdbc.update(INSERT_TOTAL, userId, "2026-10");
        assertThat(jdbc.queryForMap("SELECT lifetime_seconds, month_seconds, month_key, updated_at IS NOT NULL AS stamped "
                + "FROM sea_focus_totals WHERE user_id = ?", userId))
                .containsEntry("lifetime_seconds", 0L).containsEntry("month_seconds", 0L)
                .containsEntry("month_key", "2026-10").containsEntry("stamped", true);
        assertThatThrownBy(() -> jdbc.update(INSERT_TOTAL, userId, "2026-10"))
                .as("유저당 한 행").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT_TOTAL, UUID.randomUUID(), "2026-10"))
                .as("없는 유저").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT_TOTAL, user(jdbc), "2026-10-01"))
                .as("월 키는 7자").isInstanceOf(DataIntegrityViolationException.class);

        jdbc.update(INSERT_TIER, "base", 600, "scarf");
        // 같은 기준 분에 상품이 둘이어도 된다(유일 제약은 상품까지 본다) — 같은 상품 중복만 막는다.
        jdbc.update(INSERT_TIER, "base", 600, "hat");
        jdbc.update(INSERT_TIER, "2026-11", 600, "scarf");
        assertThatThrownBy(() -> jdbc.update(INSERT_TIER, "base", 600, "scarf"))
                .as("같은 (세트, 분, 상품) 중복").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT_TIER, "base", 0, "scarf"))
                .as("0분").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT_TIER, "base", -5, "scarf"))
                .as("음수 분").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT_TIER, "base", 30, "no-such-product"))
                .as("카탈로그에 없는 상품").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT_TIER, "S".repeat(21), 30, "scarf"))
                .as("세트 키 20자 상한").isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sea_reward_tiers", Integer.class)).isEqualTo(3);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM catalog_assets WHERE product_id = 'scarf'"))
                .as("단계표가 가리키는 카탈로그 행은 지울 수 없다").isInstanceOf(DataIntegrityViolationException.class);

        // 카탈로그가 허용하는 최대 길이(80자) 상품 id 도 단계표에 들어간다 — 열 폭이 참조 대상보다 좁으면 안 된다.
        String longestProductId = "p".repeat(80);
        product(jdbc, longestProductId, "decor", "user");
        jdbc.update(INSERT_TIER, "base", 700, longestProductId);
        assertThat(jdbc.queryForList("SELECT product_id FROM sea_reward_tiers WHERE threshold_minutes = 700",
                String.class)).containsExactly(longestProductId);

        // 운영 문서의 예 — 다음 달 시즌 한 세트는 set_key 를 달 키로 한 행 insert 뿐이다.
        jdbc.update(INSERT_TIER, "2026-12", 1200, "hat");
        assertThat(jdbc.queryForList("SELECT product_id FROM sea_reward_tiers WHERE set_key = '2026-12'",
                String.class)).containsExactly("hat");

        jdbc.update("DELETE FROM users WHERE id = ?", userId);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sea_focus_totals WHERE user_id = ?", Integer.class,
                userId)).as("users FK 는 ON DELETE CASCADE").isZero();
    }

    @Test
    @DisplayName("빈 DB 의 전체 마이그레이션 경로에서도 V112 가 성공으로 기록된다")
    void appliesOnEmptyDatabase() {
        migrate(MigrationVersion.LATEST);

        assertThat(jdbc().queryForObject("SELECT success::text FROM flyway_schema_history WHERE version = '112'",
                String.class)).isEqualTo("true");
    }

    private static Map<String, Map<String, Object>> columnsOf(JdbcTemplate jdbc, String table) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT column_name, data_type, is_nullable, "
                + "column_default, character_maximum_length FROM information_schema.columns "
                + "WHERE table_name = ?", table);
        Map<String, Map<String, Object>> columns = new HashMap<>();
        rows.forEach(row -> columns.put((String) row.get("column_name"), row));
        return columns;
    }

    private static void assertColumn(Map<String, Object> column, String type, String nullable) {
        assertThat(column).isNotNull();
        assertThat(column.get("data_type")).isEqualTo(type);
        assertThat(column.get("is_nullable")).isEqualTo(nullable);
    }

    private static UUID user(JdbcTemplate jdbc) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, created_at, is_guest, nickname, is_deleted)"
                + " VALUES (?, now(), false, ?, false)", id, "u-" + id);
        return id;
    }

    private static void product(JdbcTemplate jdbc, String productId, String kind, String ownerType) {
        jdbc.update("INSERT INTO catalog_assets (product_id, title, kind, owner_type) VALUES (?, ?, ?, ?)",
                productId, productId + "-title", kind, ownerType);
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
