package com.oneorthree.phone.appearance.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 Flyway 체인으로 90종 등록·기존 상품 보존·확률 데이터 계약과 V135(정책 revision 2·정산 행 보상 칸)를 검증한다. */
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
        migrate("134");
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
        assertThat(migrate("134")).as("동일 마이그레이션 재실행은 새 데이터를 만들지 않는다").isZero();
    }

    @Test
    @DisplayName("15분 지급·30분 희귀·60분 전설·1개·중복 및 두 장소 가중치를 저장한다")
    void storesApprovedPolicy() {
        migrate("134");
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
        migrate("132");
        JdbcTemplate jdbc = jdbc();
        jdbc.update("INSERT INTO catalog_assets (product_id,title,kind,owner_type) "
                + "VALUES ('cust.head.duck','오리 모자','head','user')");
        jdbc.update("INSERT INTO customization_asset_meta "
                + "(product_id,kind,slot,image_path,width,height,anchor_x,anchor_y,sort_order) "
                + "VALUES ('cust.head.duck','head','head','/static/old-duck.png',1254,1254,0.5,0.5,1)");
        jdbc.update("INSERT INTO sea_reward_tiers (set_key,threshold_minutes,product_id) "
                + "VALUES ('base',1,'cust.head.duck')");
        migrate("134");
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
        migrate("133");
        jdbc().update("INSERT INTO catalog_assets (product_id,title,kind,owner_type) "
                + "VALUES ('cust.head.mandarin','다른 상품','head','user')");
        assertThatThrownBy(() -> migrate("134")).isInstanceOf(FlywayException.class);
        assertThat(jdbc().queryForObject("SELECT count(*) FROM customization_reward_items", Integer.class)).isZero();
        assertThat(jdbc().queryForObject("SELECT count(*) FROM customization_reward_policies", Integer.class)).isZero();
    }

    @Test
    @DisplayName("V135 정책 revision 2 는 같은 확률에 머리·목 20종만 담고 revision 1 은 그대로 둔다")
    void revisionTwoDrawsOnlyCatAccessories() {
        migrate("135");
        JdbcTemplate jdbc = jdbc();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items WHERE revision = 1",
                Integer.class)).isEqualTo(90);
        assertThat(jdbc.queryForList("SELECT DISTINCT category FROM customization_reward_items WHERE revision = 2",
                String.class)).containsExactlyInAnyOrder("head", "neck");
        assertThat(jdbc.queryForList("SELECT count(*)::int FROM customization_reward_items WHERE revision = 2 "
                + "GROUP BY category, rarity ORDER BY category, count(*)", Integer.class))
                .containsExactly(1, 2, 3, 4, 1, 2, 3, 4);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items r2 "
                + "JOIN customization_reward_items r1 ON r1.revision = 1 AND r1.product_id = r2.product_id "
                + "AND r1.rarity = r2.rarity AND r1.sort_order = r2.sort_order AND r1.render_data = r2.render_data "
                + "WHERE r2.revision = 2", Integer.class)).as("revision 1 행을 그대로 복사했다").isEqualTo(20);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_policies p2 "
                + "JOIN customization_reward_policies p1 ON p1.revision = 1 "
                + "AND (p1.minimum_active_seconds, p1.rare_unlock_seconds, p1.legendary_unlock_seconds, "
                + "p1.time_half_seconds, p1.rare_max_bonus_ppm, p1.legendary_max_bonus_ppm, p1.location_weights) "
                + "= (p2.minimum_active_seconds, p2.rare_unlock_seconds, p2.legendary_unlock_seconds, "
                + "p2.time_half_seconds, p2.rare_max_bonus_ppm, p2.legendary_max_bonus_ppm, p2.location_weights) "
                + "WHERE p2.revision = 2 AND p2.category_weights = '{\"head\": 1, \"neck\": 1}'::jsonb",
                Integer.class)).as("확률 값은 같고 카테고리 가중치만 머리·목").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT category_weights->>'flag' FROM customization_reward_policies "
                + "WHERE revision = 1", String.class)).as("revision 1 은 그대로").isEqualTo("1");
    }

    @Test
    @DisplayName("V135 정산 행의 보상 세 칸은 함께 있거나 함께 없고, 그 revision 의 후보만 가리킬 수 있다")
    void settlementRewardColumnsArePairedAndReferenceTheRevisionItems() {
        migrate("135");
        JdbcTemplate jdbc = jdbc();
        String cat = jdbc.queryForObject("SELECT product_id FROM customization_reward_items WHERE revision = 2 "
                + "ORDER BY sort_order, product_id LIMIT 1", String.class);
        String raft = jdbc.queryForObject("SELECT product_id FROM customization_reward_items WHERE revision = 1 "
                + "AND category = 'flag' ORDER BY sort_order, product_id LIMIT 1", String.class);
        String shoes = jdbc.queryForObject("SELECT product_id FROM customization_reward_items WHERE revision = 1 "
                + "AND category = 'shoes' ORDER BY sort_order, product_id LIMIT 1", String.class);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_constraint "
                + "WHERE conrelid = 'focus_settlements'::regclass "
                + "AND conname LIKE 'focus_settlements_customization_reward%' AND NOT convalidated", Integer.class))
                .as("CHECK 둘·복합 FK 는 기존 행을 훑지 않게 NOT VALID 로 걸린다 — 새 행에는 아래처럼 강제된다")
                .isEqualTo(3);
        assertThat(settle(jdbc, 2, cat, true)).isEqualTo(1);
        assertThat(settle(jdbc, 2, cat, false)).as("이미 가진 상품을 또 뽑음").isEqualTo(1);
        assertThat(settle(jdbc, null, null, null)).as("15분 미만 — 셋 다 비어 있다").isEqualTo(1);
        assertThatThrownBy(() -> settle(jdbc, 2, null, true)).as("상품만 빠지면 CHECK 위반")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> settle(jdbc, 2, cat, null)).as("처음 가짐 여부만 빠져도 CHECK 위반")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> settle(jdbc, null, null, true)).as("뽑지 않았는데 처음 가짐도 CHECK 위반")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> settle(jdbc, 2, raft, true)).as("뗏목은 revision 2 후보가 아니다 — 복합 FK 위반")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> settle(jdbc, 2, shoes, true)).as("신발도 revision 2 후보가 아니다")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(settle(jdbc, 1, raft, true)).as("revision 1 에서는 후보다").isEqualTo(1);
    }

    /** 부모 행(상세)은 FK 를 끈 채 최소 열로 심고, 정산 행만 제약을 켠 채 넣는다. */
    private static int settle(JdbcTemplate jdbc, Integer revision, String productId, Boolean newlyOwned) {
        UUID sessionId = UUID.randomUUID();
        jdbc.execute("SET session_replication_role = replica; "
                + "INSERT INTO focus_session_details (session_id, island_id, subject, lifecycle, last_transition_at) "
                + "VALUES ('" + sessionId + "', gen_random_uuid(), 's', 'COMPLETED', now()); "
                + "SET session_replication_role = origin");
        return jdbc.update("INSERT INTO focus_settlements (session_id, active_seconds, goal_achieved, completed_at, "
                + "customization_reward_revision, customization_reward_product_id, customization_reward_new) "
                + "VALUES (?, 900, false, now(), ?, ?, ?)", sessionId, revision, productId, newlyOwned);
    }

    @Test
    @DisplayName("V136 은 머리·목 20종의 모든 revision 렌더 자료를 6색 자세 자료로 바꾸고 신발·뗏목은 그대로 둔다 (GROMO-2382)")
    void fitColorsReplaceHeadAndNeckRenderData() throws IOException {
        // V135 가 revision 1 의 머리·목 20행을 revision 2 로 복사해 둔 뒤에 V136 이 온다
        migrate("135");
        JdbcTemplate jdbc = jdbc();
        String shoesBefore = jdbc.queryForObject("SELECT render_data::text FROM customization_reward_items "
                + "WHERE product_id = 'cust.shoes.butter'", String.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items "
                + "WHERE revision = 2 AND render_data -> 'validatedColors' IS NULL", Integer.class)).isEqualTo(20);

        migrate("136");

        ObjectMapper json = new ObjectMapper();
        JsonNode bundle;
        try (InputStream in = getClass().getResourceAsStream("/customization/reward-catalog-v1.json")) {
            bundle = json.readTree(in);
        }
        int fitted = 0;
        for (JsonNode item : bundle.path("items")) {
            String category = item.path("category").asText();
            if (!category.equals("head") && !category.equals("neck")) {
                continue;
            }
            List<String> rows = jdbc.queryForList("SELECT render_data::text FROM customization_reward_items "
                    + "WHERE product_id = ?", String.class, item.path("productId").asText());
            assertThat(rows).hasSize(2);
            for (String row : rows) {
                assertThat(json.readTree(row)).as(item.path("productId").asText()).isEqualTo(item.path("renderData"));
            }
            fitted++;
        }
        assertThat(fitted).isEqualTo(20);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items "
                + "WHERE render_data -> 'validatedColors' IS NOT NULL", Integer.class)).isEqualTo(40);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items "
                + "WHERE revision = 2 AND render_data -> 'validatedColors' IS NOT NULL", Integer.class))
                .as("V135 의 revision 2 머리·목 20행도 바뀐다").isEqualTo(20);
        assertThat(jdbc.queryForObject("SELECT render_data->'colorContactFrames'->'ginger'->'blink-0'->>'x' "
                + "FROM customization_reward_items WHERE revision = 2 AND product_id = 'cust.head.mandarin'",
                String.class)).isNotNull();
        assertThat(jdbc.queryForObject("SELECT render_data::text FROM customization_reward_items "
                + "WHERE product_id = 'cust.shoes.butter'", String.class)).isEqualTo(shoesBefore);
    }

    @Test
    @DisplayName("V136 이 6색 자료를 넣지 못한 머리·목 행이 남으면 마이그레이션 전체를 실패시킨다 (GROMO-2382)")
    void fitColorsRejectHeadOrNeckRowItDidNotUpdate() {
        migrate("135");
        JdbcTemplate jdbc = jdbc();
        jdbc.update("INSERT INTO catalog_assets (product_id,title,kind,owner_type) "
                + "VALUES ('cust.head.extra','추가 머리','head','user')");
        jdbc.update("INSERT INTO customization_reward_items (revision, product_id, source_asset_id, category, rarity, "
                + "rarity_reason, render_data, sort_order) "
                + "VALUES (2, 'cust.head.extra', 'extra', 'head', 'common', 'test', '{}', 0)");
        assertThatThrownBy(() -> migrate("136")).isInstanceOf(FlywayException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customization_reward_items "
                + "WHERE render_data -> 'validatedColors' IS NOT NULL", Integer.class)).as("UPDATE 도 되돌린다").isZero();
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
