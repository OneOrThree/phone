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
