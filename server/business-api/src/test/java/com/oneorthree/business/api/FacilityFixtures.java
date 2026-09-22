package com.oneorthree.business.api;

import java.util.Arrays;
import java.util.stream.Collectors;

import static com.oneorthree.business.api.ScreenContractTestBase.ISLAND;

/** 시설 화면 계약 테스트 공통 fixture (GROMO-1898) — 주민 섬 상세와 건설 옵션. */
final class FacilityFixtures {

    static final String SHARED_INVENTORY = "{\"audio\":[\"waves\"],\"islandThemes\":[\"pine\"],"
            + "\"buildingThemes\":[{\"buildingId\":\"hall\",\"themeId\":\"hall_theme\"}],"
            + "\"inventoryVersion\":1,"
            + "\"appearance\":{\"islandThemeId\":\"pine\",\"buildingThemes\":{\"hall\":\"default\"},"
            + "\"version\":5}}";

    /** 상점 지갑 두 개 (GROMO-1781) — 개인 지갑엔 version 축이 없어 fishVersion 은 null 이다. */
    static final String WALLETS = "{\"fish\":500,\"villagePoints\":1500,\"fishVersion\":null,"
            + "\"villagePointsVersion\":7}";

    /** 상점 목록 한 쪽 (GROMO-1781) — 다음 쪽이 없다. */
    static final String PRODUCTS = "{\"items\":[{\"id\":\"rain\",\"title\":\"오두막의 빗소리\",\"kind\":\"audio\","
            + "\"price\":30,\"currency\":\"village_points\",\"ownerType\":\"island\",\"owned\":false,"
            + "\"available\":true,\"reason\":null,\"productVersion\":5}],\"publicationVersion\":1,"
            + "\"hasMore\":false,\"lastDisplayOrder\":null,\"lastProductId\":null}";

    private FacilityFixtures() {
    }

    static String detail() {
        return "{\"id\":\"" + ISLAND + "\",\"name\":\"모래섬\",\"intro\":\"\",\"visibility\":\"public\","
                + "\"approvalRequired\":false,\"memberCount\":2,\"maxMembers\":15,\"membershipStatus\":\"active\","
                + "\"growthStage\":null,\"themeId\":null,\"role\":\"member\",\"version\":3}";
    }

    /** 건설 옵션 — items 는 완공하지 않은 건물만 담는다. 인자로 받은 건물이 미완공이다. */
    static String options(String... pending) {
        String items = Arrays.stream(pending)
                .map(id -> "{\"id\":\"" + id + "\",\"name\":\"시설\",\"cost\":1360,\"currency\":\"village_points\","
                        + "\"selectable\":true,\"buildable\":false,\"blockedReason\":null}")
                .collect(Collectors.joining(","));
        return "{\"islandVersion\":4,\"costPolicyVersion\":1,\"selectedBuildingId\":null,\"villagePoints\":0,"
                + "\"walletVersion\":7,\"items\":[" + items + "]}";
    }
}
