package com.oneorthree.business.api;

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
 * 도메인 GET 이 아직 없어 완공 판정을 먼저 한다. 지갑·상품 GET 이 없어 두 조각은 missingFragments 다.
 */
class ShopScreenContractTest extends ScreenContractTestBase {

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_OPTIONS = DATA_ISLAND + "/construction-options";
    private static final String DATA_INVENTORY = DATA_ISLAND + "/inventory";

    @BeforeEach
    void island() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + FacilityFixtures.detail()
                + "}"));
        DATA.on(DATA_OPTIONS, request -> ok(FacilityFixtures.options()));
        DATA.on(DATA_INVENTORY, request -> ok(FacilityFixtures.SHARED_INVENTORY));
    }

    @Test
    @DisplayName("상점 완공: 공동 보유품을 싣고 wallets·products 는 null + missingFragments")
    void composesSharedInventory() throws Exception {
        MvcResult result = mockMvc.perform(auth(get("/screens/shop")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.sharedInventory.inventoryVersion").value(1))
                .andExpect(jsonPath("$.data.sharedInventory.appearance.version").value(5))
                .andExpect(jsonPath("$.data.wallets").value(nullValue()))
                .andExpect(jsonPath("$.data.products").value(nullValue()))
                .andExpect(jsonPath("$.data.missingFragments[0]").value("wallets"))
                .andExpect(jsonPath("$.data.missingFragments[1]").value("products"))
                .andReturn();

        assertKeys(result, "island", "sharedInventory", "wallets", "products", "missingFragments");
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
    @DisplayName("query 는 받지 않는다 — 상품 GET 이 생길 때 category 를 연다")
    void rejectsAnyQuery() throws Exception {
        mockMvc.perform(auth(get("/screens/shop")).queryParam("category", "island"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));
        assertThat(DATA.received()).isEmpty();
    }
}
