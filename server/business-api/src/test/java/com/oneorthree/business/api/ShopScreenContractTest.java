package com.oneorthree.business.api;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/shop} 계약 (GROMO-1898) — 섬 문맥 → 상점 완공 판정(건설 옵션) → 공동 보유품. 상점을 가리는
 * 도메인 GET 이 아직 없어 완공 판정을 먼저 한다. 지갑·상품 첫 페이지(GROMO-1781)는 공동 보유품과 같은 병렬 단계다.
 */
class ShopScreenContractTest extends ScreenContractTestBase {

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_OPTIONS = DATA_ISLAND + "/construction-options";
    private static final String DATA_INVENTORY = DATA_ISLAND + "/inventory";
    private static final String DATA_PRODUCTS = DATA_ISLAND + "/shop/products";
    private static final String DATA_WALLETS = DATA_ISLAND + "/shop/wallets";

    @BeforeEach
    void island() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + FacilityFixtures.detail()
                + "}"));
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options()));
        DATA.on(DATA_INVENTORY, request -> ok(FacilityFixtures.SHARED_INVENTORY));
        DATA.on(DATA_PRODUCTS, request -> ok(FacilityFixtures.PRODUCTS));
        DATA.on(DATA_WALLETS, request -> ok(FacilityFixtures.WALLETS));
    }

    @Test
    @DisplayName("상점 완공: 공동 보유품·지갑·상품 첫 페이지 — category 없으면 personal")
    void composesSharedInventory() throws Exception {
        MvcResult result = mockMvc.perform(auth(get("/screens/shop")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.sharedInventory.inventoryVersion").value(1))
                .andExpect(jsonPath("$.data.sharedInventory.appearance.version").value(5))
                .andExpect(jsonPath("$.data.wallets.villagePoints").value(1500))
                .andExpect(jsonPath("$.data.wallets.fishVersion").value(nullValue()))
                .andExpect(jsonPath("$.data.products.items[0].id").value("rain"))
                .andExpect(jsonPath("$.data.products.items[0].reason").value(nullValue()))
                .andExpect(jsonPath("$.data.products.nextCursor").value(nullValue()))
                .andReturn();

        assertKeys(result, "island", "sharedInventory", "wallets", "products");
        assertThat(DATA.receivedFor(DATA_PRODUCTS).get(0).query().split("&"))
                .containsExactlyInAnyOrder("category=personal", "limit=30");
    }

    @Test
    @DisplayName("category=island 는 상품 GET 에 그대로 넘기고, 다음 쪽이 있으면 도메인 GET 이 이어받는 서명 커서를 준다")
    void islandCategoryWithCursor() throws Exception {
        DATA.on(DATA_PRODUCTS, request -> ok(FacilityFixtures.PRODUCTS.replace("\"hasMore\":false,"
                + "\"lastDisplayOrder\":null,\"lastProductId\":null", "\"hasMore\":true,"
                + "\"lastDisplayOrder\":10,\"lastProductId\":\"rain\"")));

        MvcResult result = mockMvc.perform(auth(get("/screens/shop")).queryParam("category", "island"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.products.nextCursor").isString())
                .andReturn();

        assertThat(DATA.receivedFor(DATA_PRODUCTS).get(0).query().split("&"))
                .containsExactlyInAnyOrder("category=island", "limit=30");
        String cursor = JsonPath.read(result.getResponse().getContentAsString(),
                "$.data.products.nextCursor");
        mockMvc.perform(auth(get("/islands/" + ISLAND + "/shop/products")).queryParam("category", "island")
                        .queryParam("cursor", cursor))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_PRODUCTS).get(1).query().split("&"))
                .containsExactlyInAnyOrder("category=island", "publicationVersion=1",
                        "afterDisplayOrder=10", "afterProductId=rain", "limit=30");
    }

    @Test
    @DisplayName("활성 카탈로그가 없으면 products 는 빈 목록이다 — 화면은 200 (N25)")
    void emptyCatalogIsEmptyList() throws Exception {
        DATA.on(DATA_PRODUCTS, request -> ok("{\"items\":[],\"publicationVersion\":null,\"hasMore\":false,"
                + "\"lastDisplayOrder\":null,\"lastProductId\":null}"));

        mockMvc.perform(auth(get("/screens/shop")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.products.items.length()").value(0))
                .andExpect(jsonPath("$.data.products.nextCursor").value(nullValue()));
    }

    @Test
    @DisplayName("상점 미완공: 화면 전체 403 FACILITY_LOCKED — 조각을 부르지 않는다")
    void shopLockedFailsWholeScreen() throws Exception {
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options("tower", "shop")));

        mockMvc.perform(auth(get("/screens/shop")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
        assertThat(DATA.hits(DATA_INVENTORY)).isZero();
    }

    @Test
    @DisplayName("공동 보유품의 도메인 403 은 화면 전체 403 이다")
    void inventoryForbiddenFailsWholeScreen() throws Exception {
        DATA.on(DATA_INVENTORY, request -> domainError(403, "MEMBER_ONLY"));

        mockMvc.perform(auth(get("/screens/shop")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    @DisplayName("category 밖의 query 는 400, sound 등 허용 밖 category 는 422 — 상류를 부르지 않는다")
    void rejectsOtherQueries() throws Exception {
        mockMvc.perform(auth(get("/screens/shop")).queryParam("cursor", "x"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        mockMvc.perform(auth(get("/screens/shop")).queryParam("category", "sound"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("OUT_OF_RANGE"))
                .andExpect(jsonPath("$.error.field").value("category"));
        assertThat(DATA.received()).isEmpty();
    }
}
