package com.oneorthree.phone.appearance.repository;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 Flyway 체인으로 90종 등록·기존 상품 보존·확률 데이터 계약을 검증한다. */
class CustomizationRewardCatalogMigrationTest {

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
    }

    @Test
    @DisplayName("빈 DB에 90종·9분류·4등급을 등록하고 단계표와 정적 장착 메타는 채우지 않는다")
    void registersFullCatalogWithoutActivatingLegacyRewards() {
        migrate("132");
        JdbcTemplate jdbc = jdbc();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items", Integer.class))
                .isEqualTo(90);
        assertThat(jdbc.queryForList("SELECT count(*)::int FROM customization_reward_items GROUP BY category",
                Integer.class)).hasSize(9).containsOnly(10);
        assertThat(jdbc.queryForList("SELECT count(*)::int FROM customization_reward_items "
                + "GROUP BY rarity ORDER BY count(*)", Integer.class)).containsExactly(9, 18, 27, 36);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items i "
                + "JOIN catalog_assets c USING (product_id) WHERE c.owner_type = 'user' "
                + "AND c.kind = CASE WHEN i.category IN ('head','neck','shoes') THEN i.category ELSE 'decor' END",
                Integer.class)).isEqualTo(90);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items "
                + "WHERE render_data->'source'->>'path' LIKE '/static/customization/%.png'", Integer.class))
                .isEqualTo(90);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sea_reward_tiers", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_asset_meta", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM owned_products", Integer.class)).isZero();
        assertThat(migrate("132")).as("동일 마이그레이션 재실행은 새 데이터를 만들지 않는다").isZero();
    }

    @Test
    @DisplayName("15분 지급·30분 희귀·60분 전설·1개·중복 및 두 장소 가중치를 저장한다")
    void storesApprovedPolicy() {
        migrate("132");
        var row = jdbc().queryForMap("SELECT * FROM customization_reward_policies WHERE revision = 1");
        assertThat(row).containsEntry("minimum_active_seconds", 900)
                .containsEntry("rare_unlock_seconds", 1800)
                .containsEntry("legendary_unlock_seconds", 3600)
                .containsEntry("rewards_per_eligible_session", 1)
                .containsEntry("duplicates_allowed", true)
                .containsEntry("time_half_seconds", 7200)
                .containsEntry("rare_max_bonus_ppm", 30000)
                .containsEntry("legendary_max_bonus_ppm", 10000);
        assertThat(jdbc().queryForObject("SELECT location_weights->'ISLAND'->>'rare' "
                + "FROM customization_reward_policies", String.class)).isEqualTo("18");
        assertThat(jdbc().queryForObject("SELECT location_weights->'SEA'->>'rare' "
                + "FROM customization_reward_policies", String.class)).isEqualTo("7");
        assertThatThrownBy(() -> jdbc().update("UPDATE customization_reward_policies "
                + "SET rewards_per_eligible_session = 2")).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc().update("UPDATE customization_reward_policies "
                + "SET rare_unlock_seconds = 3601")).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc().update("UPDATE customization_reward_items SET rarity = 'mythical'"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("기존 오리 모자 ID·이미지·보상 단계는 보존하고 새 인형에는 별도 ID를 쓴다")
    void preservesPublishedDuckIdentityAndMetadata() {
        migrate("130");
        JdbcTemplate jdbc = jdbc();
        jdbc.update("INSERT INTO catalog_assets (product_id,title,kind,owner_type) "
                + "VALUES ('cust.head.duck','오리 모자','head','user')");
        jdbc.update("INSERT INTO customization_asset_meta "
                + "(product_id,kind,slot,image_path,width,height,anchor_x,anchor_y,sort_order) "
                + "VALUES ('cust.head.duck','head','head','/static/old-duck.png',1254,1254,0.5,0.5,1)");
        jdbc.update("INSERT INTO sea_reward_tiers (set_key,threshold_minutes,product_id) "
                + "VALUES ('base',1,'cust.head.duck')");
        migrate("132");
        assertThat(jdbc.queryForObject("SELECT title FROM catalog_assets WHERE product_id = 'cust.head.duck'",
                String.class)).isEqualTo("오리 모자");
        assertThat(jdbc.queryForObject("SELECT image_path FROM customization_asset_meta "
                + "WHERE product_id = 'cust.head.duck'", String.class)).isEqualTo("/static/old-duck.png");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sea_reward_tiers", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT title FROM catalog_assets WHERE product_id = 'cust.head.duck-plush'",
                String.class)).isEqualTo("오리 인형");
    }

    @Test
    @DisplayName("새 목록의 ID가 다른 의미로 이미 존재하면 조용히 연결하지 않고 시드 트랜잭션을 실패시킨다")
    void rejectsConflictingProductIdentity() {
        migrate("131");
        jdbc().update("INSERT INTO catalog_assets (product_id,title,kind,owner_type) "
                + "VALUES ('cust.head.mandarin','다른 상품','head','user')");
        assertThatThrownBy(() -> migrate("132")).isInstanceOf(FlywayException.class);
        assertThat(jdbc().queryForObject("SELECT count(*) FROM customization_reward_items", Integer.class)).isZero();
        assertThat(jdbc().queryForObject("SELECT count(*) FROM customization_reward_policies", Integer.class)).isZero();
    }

    private int migrate(String target) {
        return Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration").target(target).load().migrate().migrationsExecuted;
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }
}
