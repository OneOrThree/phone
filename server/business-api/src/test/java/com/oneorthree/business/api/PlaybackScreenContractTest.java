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
 * {@code GET /screens/playback} 계약 (GROMO-1898) — 섬 문맥 뒤 공동 보유품·재생 상태 병렬. 방송기 미완공은 재생
 * GET 의 게이트({@code GRAM_LOCKED})가 그대로 화면 전체 403 이다. 판매 음원·지갑 GET 이 없어 두 조각은 missing 이다.
 */
class PlaybackScreenContractTest extends ScreenContractTestBase {

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_INVENTORY = DATA_ISLAND + "/inventory";
    private static final String DATA_PLAYBACK = DATA_ISLAND + "/playback";
    private static final String DATA_PRODUCTS = DATA_ISLAND + "/shop/products";
    private static final String DATA_WALLETS = DATA_ISLAND + "/shop/wallets";

    private static final String PLAYBACK = "{\"trackId\":\"waves\",\"playing\":true,\"positionSeconds\":12,"
            + "\"effectiveAt\":\"2026-09-11T09:10:00Z\",\"changedBy\":\"" + USER + "\",\"version\":2,"
            + "\"serverNow\":\"2026-09-11T09:10:00Z\",\"durationSeconds\":120.5}";

    @BeforeEach
    void island() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":" + FacilityFixtures.detail()
                + "}"));
        DATA.on(DATA_INVENTORY, request -> ok(FacilityFixtures.SHARED_INVENTORY));
        DATA.on(DATA_PLAYBACK, request -> ok(PLAYBACK));
        DATA.on(DATA_PRODUCTS, request -> ok(FacilityFixtures.PRODUCTS));
        DATA.on(DATA_WALLETS, request -> ok(FacilityFixtures.WALLETS));
    }

    @Test
    @DisplayName("정상: 공동 보유품·재생 상태·판매 음원(category=sound, B20)·지갑")
    void composesInventoryAndPlayback() throws Exception {
        MvcResult result = mockMvc.perform(auth(get("/screens/playback")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.id").value(ISLAND.toString()))
                .andExpect(jsonPath("$.data.sharedInventory.audio[0]").value("waves"))
                .andExpect(jsonPath("$.data.playback.trackId").value("waves"))
                .andExpect(jsonPath("$.data.playback.version").value(2))
                .andExpect(jsonPath("$.data.playback.durationSeconds").value(120.5))
                .andExpect(jsonPath("$.data.products.items[0].id").value("rain"))
                .andExpect(jsonPath("$.data.products.items[0].productVersion").value(5))
                .andExpect(jsonPath("$.data.products.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.data.wallets.villagePoints").value(1500))
                .andReturn();

        assertKeys(result, "island", "sharedInventory", "playback", "products", "wallets");
        assertThat(DATA.receivedFor(DATA_PRODUCTS).get(0).query().split("&"))
                .containsExactlyInAnyOrder("category=sound", "limit=30");
        assertThat(DATA.receivedFor(DATA_PLAYBACK).get(0).header("x-user-id")).isEqualTo(USER.toString());
    }

    @Test
    @DisplayName("방송기 미완공(도메인 GRAM_LOCKED)은 화면 전체 403 FACILITY_LOCKED")
    void gramLockedFailsWholeScreen() throws Exception {
        DATA.on(DATA_PLAYBACK, request -> domainError(403, "GRAM_LOCKED"));

        mockMvc.perform(auth(get("/screens/playback")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FACILITY_LOCKED"));
    }

    @Test
    @DisplayName("재생 상태 불변식이 깨지면 화면 전체 502 — 도메인 GET 과 같은 검증")
    void brokenPlaybackIsContractError() throws Exception {
        DATA.on(DATA_PLAYBACK, request -> ok(PLAYBACK.replace("120.5", "null")));

        mockMvc.perform(auth(get("/screens/playback")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
    }

    @Test
    @DisplayName("현재 섬이 없으면 409 — 조각을 부르지 않는다")
    void noCurrentIslandIsConflict() throws Exception {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":null}"));

        mockMvc.perform(auth(get("/screens/playback")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.field").value("currentIslandId"));
        assertThat(DATA.hits(DATA_INVENTORY) + DATA.hits(DATA_PLAYBACK)).isZero();
    }
}
