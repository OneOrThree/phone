package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.dto.CustomizationCatalogItem;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/** 꾸미기 카탈로그 내부 조회 (GROMO-2331) — 그림 정보가 있는 상품만, 퇴역 표시 포함. */
@SpringBootTest
@Transactional
class CustomizationCatalogIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    CustomizationCatalogService service;
    @Autowired
    JdbcTemplate jdbc;
    /** HTTP 응답을 쓰는 Boot 4 의 Jackson 3 mapper — 직렬화 모양을 그대로 본다. */
    @Autowired
    tools.jackson.databind.ObjectMapper http;

    @Test
    @DisplayName("메타 없는 카탈로그 행은 빠지고, 퇴역 상품은 retiredAt 과 함께 내려가며 정렬 순서를 따른다")
    void listsOnlyAssetsWithMetaIncludingRetired() {
        product("cust.t.duck", "head");
        product("cust.t.bell", "neck");
        product("cust.t.nometa", "shoes");
        meta("cust.t.duck", "head", 2, false);
        meta("cust.t.bell", "neck", 1, true);

        List<CustomizationCatalogItem> items = service.catalog().stream()
                .filter(i -> i.productId().startsWith("cust.t.")).toList();

        assertThat(items).extracting(CustomizationCatalogItem::productId)
                .containsExactly("cust.t.bell", "cust.t.duck");
        CustomizationCatalogItem bell = items.get(0);
        assertThat(bell.retiredAt()).isNotNull();
        assertThat(bell.slot()).isEqualTo("neck");
        assertThat(bell.title()).isEqualTo("cust.t.bell-title");
        assertThat(items.get(1).retiredAt()).isNull();
        assertThat(items.get(1).imagePath()).isEqualTo("/static/customization/head/cust.t.duck.abcd1234.png");
        assertThat(items.get(1).anchorY()).isEqualByComparingTo(new BigDecimal("0.1"));
    }

    @Test
    @DisplayName("집중 보상 머리·목 20종을 renderData 와 함께 정적 오버레이 뒤에 싣고, 신발·뗏목은 싣지 않는다 (GROMO-2382)")
    void appendsCatRewardsWithRenderData() {
        product("cust.t.duck", "head");
        meta("cust.t.duck", "head", 99, false);

        List<CustomizationCatalogItem> all = service.catalog();
        List<CustomizationCatalogItem> rewards = all.stream().filter(i -> i.renderData() != null).toList();

        assertThat(rewards).hasSize(20);
        assertThat(rewards).extracting(CustomizationCatalogItem::slot).filteredOn("head"::equals).hasSize(10);
        assertThat(rewards).extracting(CustomizationCatalogItem::slot).filteredOn("neck"::equals).hasSize(10);
        assertThat(all).as("신발은 보상에서 빠졌고 뗏목은 고양이에 입히지 않는다")
                .noneMatch(i -> i.productId().startsWith("cust.shoes.") || i.productId().startsWith("cust.decor."));
        assertThat(all.indexOf(item(all, "cust.t.duck"))).as("정적 오버레이가 먼저").isLessThan(all.indexOf(rewards.get(0)));
        assertThat(rewards).extracting(CustomizationCatalogItem::sortOrder).isSorted();
        // 보상 행은 kind(catalog_assets)를 slot 으로 쓰고 쿼리는 category(보상 목록)로 거른다 — 둘이 같아야 한다
        Map<String, String> categories = jdbc
                .queryForList("SELECT DISTINCT product_id, category FROM customization_reward_items").stream()
                .collect(Collectors.toMap(r -> (String) r.get("product_id"), r -> (String) r.get("category")));
        assertThat(rewards).allSatisfy(r -> {
            assertThat(r.kind()).as(r.productId()).isEqualTo(categories.get(r.productId()));
            assertThat(r.slot()).as(r.productId()).isEqualTo(r.kind());
        });

        CustomizationCatalogItem mandarin = item(all, "cust.head.mandarin");
        assertThat(mandarin.title()).isEqualTo("귤 한 알");
        assertThat(mandarin.kind()).isEqualTo("head");
        assertThat(mandarin.slot()).isEqualTo("head");
        assertThat(mandarin.imagePath()).isEqualTo("/static/customization/head/mandarin.cfb06049.png");
        assertThat(mandarin.width()).isNull();
        assertThat(mandarin.height()).isNull();
        assertThat(mandarin.anchorX()).isNull();
        assertThat(mandarin.anchorY()).isNull();
        assertThat(mandarin.retiredAt()).isNull();
        assertThat(mandarin.renderData()).containsEntry("format", "cat-fit-v1").containsEntry("drawWidth", 64)
                .containsEntry("itemDepthY", 9)
                .containsEntry("rigPath", "/static/customization/rigs/head.0093c1a9.json");
        assertThat(map(map(mandarin.renderData(), "contactFrames"), "walk-0"))
                .containsEntry("x", 277).containsEntry("y", 182).containsEntry("angleDegrees", -20.6);

        CustomizationCatalogItem bell = item(all, "cust.neck.bell");
        assertThat(bell.title()).isEqualTo("버터 방울 목걸이");
        assertThat(bell.renderData()).containsEntry("neckStyle", "pendant");
        assertThat(map(bell.renderData(), "commonBand"))
                .containsEntry("path", "/static/customization/neck/common-band.1acc2be4.png");
    }

    @Test
    @DisplayName("정적 오버레이 행의 JSON 은 renderData 키 없이 이전 11개 필드 그대로다 (GROMO-2382)")
    void staticOverlayJsonIsUnchanged() {
        product("cust.t.duck", "head");
        meta("cust.t.duck", "head", 99, false);
        List<CustomizationCatalogItem> all = service.catalog();

        var overlay = http.readTree(http.writeValueAsString(item(all, "cust.t.duck")));
        assertThat(overlay.propertyNames()).containsExactly("productId", "kind", "slot", "title", "imagePath",
                "width", "height", "anchorX", "anchorY", "sortOrder", "retiredAt");
        assertThat(overlay.path("width").asInt()).isEqualTo(64);

        var reward = http.readTree(http.writeValueAsString(item(all, "cust.head.mandarin")));
        assertThat(reward.path("width").isNull()).isTrue();
        assertThat(reward.path("renderData").path("contactFrames").path("reel-2").path("x").asInt()).isEqualTo(238);
    }

    @Test
    @DisplayName("같은 상품은 가장 큰 revision 하나만 싣고, 정적 오버레이가 있는 상품은 오버레이 행만 싣는다 (GROMO-2382)")
    void latestRevisionOnceAndOverlayWins() {
        // 다른 마이그레이션이 revision 을 더 올려 두었어도 그 위에 하나 더 쌓는다
        int next = jdbc.queryForObject("SELECT max(revision) + 1 FROM customization_reward_policies", Integer.class);
        jdbc.update("INSERT INTO customization_reward_policies (revision, minimum_active_seconds, rare_unlock_seconds, "
                + "legendary_unlock_seconds, time_half_seconds, rare_max_bonus_ppm, legendary_max_bonus_ppm, "
                + "rewards_per_eligible_session, duplicates_allowed, location_weights, category_weights, "
                + "source_workbook_sha256) SELECT ?, minimum_active_seconds, rare_unlock_seconds, "
                + "legendary_unlock_seconds, time_half_seconds, rare_max_bonus_ppm, legendary_max_bonus_ppm, "
                + "rewards_per_eligible_session, duplicates_allowed, location_weights, category_weights, "
                + "source_workbook_sha256 FROM customization_reward_policies WHERE revision = 1", next);
        jdbc.update("INSERT INTO customization_reward_items (revision, product_id, source_asset_id, category, rarity, "
                + "rarity_reason, render_data, sort_order) SELECT ?, product_id, source_asset_id, category, rarity, "
                + "rarity_reason, render_data || '{\"drawWidth\": 70}'::jsonb, 500 "
                + "FROM customization_reward_items WHERE revision = 1 AND product_id = 'cust.head.mandarin'", next);
        meta("cust.neck.bell", "neck", 99, false);

        List<CustomizationCatalogItem> all = service.catalog();

        assertThat(all).filteredOn(i -> i.productId().equals("cust.head.mandarin")).singleElement()
                .satisfies(i -> {
                    assertThat(i.sortOrder()).isEqualTo(500);
                    assertThat(i.renderData()).containsEntry("drawWidth", 70);
                });
        assertThat(all).filteredOn(i -> i.productId().equals("cust.neck.bell")).singleElement()
                .satisfies(i -> assertThat(i.renderData()).isNull());
    }

    private static CustomizationCatalogItem item(List<CustomizationCatalogItem> items, String productId) {
        return items.stream().filter(i -> i.productId().equals(productId)).findFirst().orElseThrow();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Map<String, Object> parent, String key) {
        return (Map<String, Object>) parent.get(key);
    }

    private void product(String id, String kind) {
        jdbc.update("INSERT INTO catalog_assets (product_id, title, kind, owner_type, created_at) "
                + "VALUES (?, ?, ?, 'user', now())", id, id + "-title", kind);
    }

    private void meta(String id, String kind, int sort, boolean retired) {
        jdbc.update("INSERT INTO customization_asset_meta (product_id, kind, slot, image_path, width, height, "
                + "anchor_x, anchor_y, sort_order, retired_at) VALUES (?, ?, ?, ?, 64, 64, 0.5, 0.1, ?, "
                + (retired ? "now()" : "NULL") + ")",
                id, kind, kind, "/static/customization/" + kind + "/" + id + ".abcd1234.png", sort);
    }
}
