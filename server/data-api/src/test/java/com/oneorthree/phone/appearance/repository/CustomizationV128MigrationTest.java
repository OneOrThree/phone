package com.oneorthree.phone.appearance.repository;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** V128 꾸미기 슬롯 3종·이미지 메타의 실 SQL 검증 (GROMO-2331) — 전용 컨테이너에 Flyway 체인을 돌린다. */
class CustomizationV128MigrationTest {

    private static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
        POSTGRES.start();
    }

    @BeforeEach
    void resetSchema() {
        JdbcTemplate jdbc = jdbc();
        jdbc.execute("DROP SCHEMA public CASCADE");
        jdbc.execute("CREATE SCHEMA public");
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").load().migrate();
    }

    @Test
    @DisplayName("head·neck·shoes 는 개인(user) 소유로만 카탈로그에 들어가고 섬 소유·미지정 종류는 거부된다")
    void kindCheckAcceptsSlotKindsForUserOnly() {
        JdbcTemplate jdbc = jdbc();
        for (String kind : new String[] {"head", "neck", "shoes"}) {
            product(jdbc, "p-" + kind, kind, "user");
        }
        assertThatThrownBy(() -> product(jdbc, "p-bad-owner", "head", "island"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> product(jdbc, "p-bad-kind", "hat", "user"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("personal_appearances 에 head·neck·shoes 열이 생기고 카탈로그 FK 가 걸린다")
    void personalAppearancesHasSlotColumns() {
        JdbcTemplate jdbc = jdbc();
        assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.columns "
                + "WHERE table_name = 'personal_appearances' AND column_name IN ('head','neck','shoes')",
                String.class)).containsExactlyInAnyOrder("head", "neck", "shoes");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM information_schema.table_constraints "
                + "WHERE table_name = 'personal_appearances' AND constraint_type = 'FOREIGN KEY'",
                Integer.class)).isGreaterThanOrEqualTo(5);   // user + clothes·decor + head·neck·shoes
    }

    @Test
    @DisplayName("customization_asset_meta 는 시드가 없고, 카탈로그 종류와 어긋나거나 크기가 0이면 거부한다")
    void metaTableRules() {
        JdbcTemplate jdbc = jdbc();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_asset_meta", Integer.class)).isZero();
        product(jdbc, "p-head", "head", "user");
        product(jdbc, "p-ad", "ad_frame", "user");

        jdbc.update(meta("p-head", "head", 64));   // 정상
        assertThatThrownBy(() -> jdbc.update(meta("p-head", "head", 64)))
                .as("product_id 유일").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(meta("p-ad", "ad_frame", 64)))
                .as("잡지 종류는 이 표의 CHECK 가 막는다").isInstanceOf(DataIntegrityViolationException.class);
        product(jdbc, "p-neck", "neck", "user");
        assertThatThrownBy(() -> jdbc.update(meta("p-neck", "head", 64)))
                .as("(product_id, kind) 복합 FK — 카탈로그 종류와 어긋나지 못한다")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(meta("p-neck", "neck", 0)))
                .as("크기는 양수").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("anchor_x·anchor_y 가 0~1 밖이면 거부한다")
    void anchorOutOfRangeRejected() {
        JdbcTemplate jdbc = jdbc();
        product(jdbc, "p-head", "head", "user");
        assertThatThrownBy(() -> jdbc.update(meta("p-head", "head", 64).replace("0.5, 0.1", "1.5, 0.1")))
                .as("anchor_x > 1").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(meta("p-head", "head", 64).replace("0.5, 0.1", "0.5, -0.1")))
                .as("anchor_y < 0").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("slot 이 kind 와 다르면 거부한다")
    void slotMustEqualKind() {
        JdbcTemplate jdbc = jdbc();
        product(jdbc, "p-head", "head", "user");
        assertThatThrownBy(() -> jdbc.update(meta("p-head", "head", 64).replace("'head', '/static", "'neck', '/static")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private static String meta(String id, String kind, int width) {
        return "INSERT INTO customization_asset_meta (product_id, kind, slot, image_path, width, height, "
                + "anchor_x, anchor_y, sort_order) VALUES ('" + id + "', '" + kind + "', '" + kind
                + "', '/static/customization/" + kind + "/" + id + ".abcd1234.png', " + width + ", 64, 0.5, 0.1, 1)";
    }

    private static void product(JdbcTemplate jdbc, String productId, String kind, String ownerType) {
        jdbc.update("INSERT INTO catalog_assets (product_id, title, kind, owner_type) VALUES (?, ?, ?, ?)",
                productId, productId + "-title", kind, ownerType);
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}
