package com.oneorthree.phone.magazine.repository;

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
 * V113 꾸미기 재료 카탈로그·V114 홍보 칸의 실 SQL 검증 (GROMO-2289). 검증 방식은 {@code SeaFocusV112MigrationTest} 선례 —
 * 전용 컨테이너에 Flyway 체인을 실제로 돌린다. CI 프로필은 엔티티로 표를 만들어 CHECK·시드를 보지 못하므로 여기서 본다.
 *
 * <p>보는 것: ① 카탈로그 종류 CHECK 가 잡지 재료 3종을 개인 소유로만 받는다 ② 시드 64행(틀 11 · 스티커 45 · 테이프 8)이
 * 전부 무료로 들어가고 기존 카탈로그 행은 그대로다 ③ 홍보 칸 표의 열·유일 제약·CHECK·FK ④ 빈 DB 의 전체 경로.
 */
class MagazineMigrationTest {

    /** 이 클래스 전용 컨테이너 — 공용 TestPostgres 는 스키마 초기화와 함께 쓸 수 없다. */
    private static final PostgreSQLContainer<?> POSTGRES;

    private static final String INSERT_PROMOTION = "INSERT INTO island_promotions "
            + "(id, island_id, issue_date, applied_by, applied_at, updated_at, body, layout) "
            + "VALUES (?, ?, ?::date, ?, now(), now(), ?, '{\"v\":1}'::jsonb)";

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

    // ---------------------------------------------------------------- V113

    @Test
    @DisplayName("V113 은 기존 카탈로그 위에 적용되고 시드 64행(틀 11 · 스티커 45 · 테이프 8)이 전부 개인 소유·무료로 들어간다")
    void seedsSixtyFourFreeAssetsOverExistingCatalog() {
        migrate(MigrationVersion.fromVersion("112"));
        JdbcTemplate jdbc = jdbc();
        product(jdbc, "scarf", "clothes", "user");

        migrate(MigrationVersion.fromVersion("113"));

        assertThat(jdbc.queryForObject("SELECT kind FROM catalog_assets WHERE product_id = 'scarf'", String.class))
                .as("기존 카탈로그 행은 그대로다").isEqualTo("clothes");
        assertThat(counts(jdbc, "SELECT kind AS k, count(*) AS n FROM catalog_assets "
                + "WHERE product_id LIKE 'mag.%' GROUP BY kind"))
                .containsExactlyInAnyOrderEntriesOf(Map.of("ad_frame", 11L, "ad_sticker", 45L, "ad_tape", 8L));
        assertThat(jdbc.queryForList("SELECT DISTINCT owner_type FROM catalog_assets WHERE kind LIKE 'ad\\_%'",
                String.class)).containsExactly("user");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM catalog_assets WHERE kind LIKE 'ad\\_%' "
                + "AND product_id NOT LIKE 'mag.%'", Integer.class)).as("잡지 재료 id 는 모두 mag. 접두어").isZero();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM magazine_asset_meta", Integer.class)).isEqualTo(64);
        assertThat(jdbc.queryForList("SELECT DISTINCT bundle FROM magazine_asset_meta", String.class))
                .as("10/14 확정 — 지금 에셋은 전부 무료").containsExactly("free");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM magazine_asset_meta WHERE retired_at IS NOT NULL",
                Integer.class)).isZero();
        assertThat(counts(jdbc, "SELECT m.drawer_tab AS k, count(*) AS n FROM magazine_asset_meta m "
                + "JOIN catalog_assets c ON c.product_id = m.product_id WHERE c.kind = 'ad_sticker' GROUP BY m.drawer_tab"))
                .containsExactlyInAnyOrderEntriesOf(Map.of("cat", 14L, "sea", 14L, "friends", 4L, "deco", 13L));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM magazine_asset_meta m JOIN catalog_assets c "
                + "ON c.product_id = m.product_id WHERE c.kind <> 'ad_sticker' AND m.drawer_tab IS NOT NULL",
                Integer.class)).as("틀·테이프는 서랍 탭이 없다").isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM (SELECT c.kind, m.sort_order FROM magazine_asset_meta m "
                + "JOIN catalog_assets c ON c.product_id = m.product_id GROUP BY c.kind, m.sort_order "
                + "HAVING count(*) > 1) dup", Integer.class)).as("종류 안의 정렬 순서는 겹치지 않는다").isZero();
        assertThat(jdbc.queryForMap("SELECT c.title, m.sort_order FROM magazine_asset_meta m "
                + "JOIN catalog_assets c ON c.product_id = m.product_id WHERE m.product_id = 'mag.frame-scallop'"))
                .containsEntry("title", "분홍 물결").containsEntry("sort_order", 1);
    }

    @Test
    @DisplayName("V113 카탈로그 CHECK — 잡지 재료는 개인 소유로만, 모르는 종류는 여전히 거부, 부가 정보는 묶음·탭 CHECK 와 카탈로그 FK")
    void catalogAndMetaConstraints() {
        migrate(MigrationVersion.fromVersion("113"));
        JdbcTemplate jdbc = jdbc();

        product(jdbc, "mag.test-sticker", "ad_sticker", "user");
        assertThatThrownBy(() -> product(jdbc, "mag.island-frame", "ad_frame", "island"))
                .as("잡지 재료는 섬 소유가 될 수 없다").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> product(jdbc, "mag.poster", "ad_poster", "user"))
                .as("모르는 종류").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> product(jdbc, "theme-x", "island_theme", "user"))
                .as("기존 조합 규칙도 그대로다").isInstanceOf(DataIntegrityViolationException.class);

        jdbc.update("INSERT INTO magazine_asset_meta (product_id, bundle, drawer_tab, sort_order) "
                + "VALUES ('mag.test-sticker', 'season', 'sea', 99)");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO magazine_asset_meta (product_id, bundle, sort_order) "
                + "VALUES ('mag.no-such', 'free', 1)")).as("카탈로그에 없는 재료")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE magazine_asset_meta SET bundle = 'paid' "
                + "WHERE product_id = 'mag.test-sticker'")).as("유료 묶음은 없다(10/14)")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE magazine_asset_meta SET drawer_tab = 'dogs' "
                + "WHERE product_id = 'mag.test-sticker'")).as("서랍 탭은 넷뿐")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM catalog_assets WHERE product_id = 'mag.test-sticker'"))
                .as("부가 정보가 가리키는 카탈로그 행은 지울 수 없다").isInstanceOf(DataIntegrityViolationException.class);
    }

    // ---------------------------------------------------------------- V114

    @Test
    @DisplayName("V114 island_promotions — 열 타입·nullability·default, 한 섬 한 호 한 칸, moderation CHECK, 글 60자, FK")
    void promotionsTableShape() {
        migrate(MigrationVersion.fromVersion("114"));
        JdbcTemplate jdbc = jdbc();

        Map<String, Map<String, Object>> columns = columnsOf(jdbc, "island_promotions");
        assertThat(columns).hasSize(11);
        assertColumn(columns.get("id"), "uuid", "NO");
        assertColumn(columns.get("island_id"), "uuid", "NO");
        assertColumn(columns.get("issue_date"), "date", "NO");
        assertColumn(columns.get("applied_by"), "uuid", "NO");
        assertColumn(columns.get("applied_at"), "timestamp with time zone", "NO");
        assertColumn(columns.get("updated_at"), "timestamp with time zone", "NO");
        assertColumn(columns.get("body"), "character varying", "NO");
        assertThat(columns.get("body")).containsEntry("character_maximum_length", 60);
        assertColumn(columns.get("layout"), "jsonb", "NO");
        assertColumn(columns.get("snapshot"), "jsonb", "YES");
        assertColumn(columns.get("moderation"), "character varying", "NO");
        assertThat((String) columns.get("moderation").get("column_default")).contains("NONE");
        assertColumn(columns.get("hidden_at"), "timestamp with time zone", "YES");
        assertThat(jdbc.queryForList("SELECT indexname FROM pg_indexes WHERE tablename = 'island_promotions'",
                String.class)).contains("island_promotions_issue_order_idx");

        UUID host = user(jdbc);
        UUID island = island(jdbc);
        jdbc.update(INSERT_PROMOTION, UUID.randomUUID(), island, "2026-10-15", host, "가".repeat(60));
        jdbc.update(INSERT_PROMOTION, UUID.randomUUID(), island, "2026-10-16", host, "🐟".repeat(60));
        assertThat(jdbc.queryForObject("SELECT moderation FROM island_promotions WHERE issue_date = '2026-10-15'",
                String.class)).isEqualTo("NONE");
        assertThatThrownBy(() -> jdbc.update(INSERT_PROMOTION, UUID.randomUUID(), island, "2026-10-15", host, "또"))
                .as("한 섬은 한 호에 한 칸").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT_PROMOTION, UUID.randomUUID(), island, "2026-10-17", host,
                "가".repeat(61))).as("글 60자 상한").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(INSERT_PROMOTION, UUID.randomUUID(), UUID.randomUUID(), "2026-10-17",
                host, "없는 섬")).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE island_promotions SET moderation = 'PENDING'"))
                .as("사전 검토 상태는 없다(10/14)").isInstanceOf(DataIntegrityViolationException.class);
        for (String state : List.of("HIDDEN", "REMOVED", "CLEARED")) {
            jdbc.update("UPDATE island_promotions SET moderation = ? WHERE issue_date = '2026-10-15'", state);
        }
        // 다른 섬은 같은 호에 실을 수 있다.
        jdbc.update(INSERT_PROMOTION, UUID.randomUUID(), island(jdbc), "2026-10-15", host, "다른 섬");

        jdbc.update("DELETE FROM groups WHERE id = ?", island);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_promotions WHERE island_id = ?", Integer.class,
                island)).as("groups FK 는 ON DELETE CASCADE").isZero();
    }

    @Test
    @DisplayName("빈 DB 의 전체 마이그레이션 경로에서도 V113·V114 가 성공으로 기록된다")
    void appliesOnEmptyDatabase() {
        migrate(MigrationVersion.LATEST);

        assertThat(jdbc().queryForList("SELECT success::text FROM flyway_schema_history "
                + "WHERE version IN ('113', '114')", String.class)).containsExactly("true", "true");
    }

    private static Map<String, Long> counts(JdbcTemplate jdbc, String sql) {
        Map<String, Long> counts = new HashMap<>();
        jdbc.queryForList(sql).forEach(row -> counts.put((String) row.get("k"), (Long) row.get("n")));
        return counts;
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

    private static UUID island(JdbcTemplate jdbc) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO groups (id, name, max_members, is_chat_enabled, invite_permission, status) "
                + "VALUES (?, '섬', 10, true, 'OWNER_ONLY', 'WAITING')", id);
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
