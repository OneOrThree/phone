package com.oneorthree.business.api;

import com.oneorthree.business.support.Tokens;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.YearMonth;
import java.time.ZoneId;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /screens/town-hall} 계약 (GROMO-1897) — 섬 문맥(역할) 뒤 주민·건설 옵션, 방장이면 신청자까지.
 * 방장 전용 조각은 역할로 호출 자체를 생략하고, 조회 도중 위임돼 Data 가 403 을 주면 화면 전체 403 이다.
 */
class TownHallScreenContractTest extends ScreenContractTestBase {

    private static final UUID APPLICANT = UUID.fromString("dddddddd-1897-0000-0000-000000000004");

    private static final String DATA_ISLAND = "GET /internal/islands/" + ISLAND;
    private static final String DATA_MEMBERS = DATA_ISLAND + "/members";
    private static final String DATA_OPTIONS = DATA_ISLAND + "/construction-options";
    private static final String DATA_REQUESTS = DATA_ISLAND + "/join-requests";
    private static final String DATA_WALLETS = DATA_ISLAND + "/shop/wallets";
    private static final String DATA_LEDGER = DATA_ISLAND + "/resources/ledger";

    private static final UUID ENTRY = UUID.fromString("eeeeeeee-1786-0000-0000-000000000001");
    private static final String LEDGER = "{\"month\":\"%s\",\"earnedTotal\":4800,\"spentTotal\":1360,"
            + "\"items\":[{\"id\":\"" + ENTRY + "\",\"direction\":\"earn\",\"reason\":\"contribution\","
            + "\"amount\":480,\"createdAt\":\"2026-09-11T00:00:00Z\",\"groupedUntil\":\"2026-09-11T14:00:00Z\","
            + "\"entryCount\":480}],\"nextCreatedAt\":\"2026-09-11T00:00:00Z\",\"nextEntryId\":\"" + ENTRY + "\"}";
    /** 화면이 무엇을 요청하든 같은 달을 되돌려 줘야 계약 검사를 통과한다 — 달 경계는 KST 다. */
    private static final String KST_MONTH = YearMonth.now(ZoneId.of("Asia/Seoul")).toString();

    private static final String MEMBERS = "{\"items\":[{\"id\":\"" + USER + "\",\"name\":\"고양이\",\"role\":\"host\","
            + "\"appearance\":{\"clothes\":\"scarf\",\"decor\":null,"
            + "\"hull\":\"raft\",\"position\":\"front\",\"version\":2}}],"
            + "\"nextJoinedAt\":\"2026-09-19T01:02:03.123456Z\",\"nextMembershipId\":\"" + APPLICANT
            + "\",\"version\":9}";
    private static final String OPTIONS = "{\"islandVersion\":4,\"costPolicyVersion\":1,"
            + "\"selectedBuildingId\":\"gram\",\"villagePoints\":150,\"walletVersion\":7,"
            + "\"items\":[{\"id\":\"gram\",\"name\":\"꽃나팔 방송기\",\"cost\":1360,"
            + "\"currency\":\"village_points\",\"selectable\":true,\"buildable\":true,\"blockedReason\":null}]}";
    private static final String REQUESTS = "{\"items\":[{\"id\":\"" + REQUEST + "\",\"applicantId\":\"" + APPLICANT
            + "\",\"name\":\"신청자\",\"status\":\"pending\",\"version\":0}],\"nextCreatedAt\":null,\"nextRequestId\":null}";

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void island() {
        DATA.on(DATA_MINE, request -> ok("{\"items\":[],\"currentIslandId\":\"" + ISLAND + "\"}"));
        role("host");
        DATA.on(DATA_MEMBERS, request -> ok(MEMBERS));
        DATA.on(DATA_OPTIONS, request -> ok(OPTIONS));
        DATA.on(DATA_REQUESTS, request -> ok(REQUESTS));
        DATA.on(DATA_WALLETS, request -> ok(FacilityFixtures.WALLETS));
        DATA.on(DATA_LEDGER, request -> ok(LEDGER.formatted(KST_MONTH)));
    }

    @Test
    @DisplayName("방장: 신청자 목록을 함께 읽고 available — 목록 커서는 도메인 GET 이 이어받는 서명 커서다")
    void hostReadsJoinRequests() throws Exception {
        MvcResult result = mockMvc.perform(auth(get("/screens/town-hall")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.island.role").value("host"))
                .andExpect(jsonPath("$.data.members.items[0].id").value(USER.toString()))
                .andExpect(jsonPath("$.data.members.version").value(9))
                .andExpect(jsonPath("$.data.constructionOptions.villagePoints").value(150))
                .andExpect(jsonPath("$.data.constructionOptions.items[0].id").value("gram"))
                .andExpect(jsonPath("$.data.joinRequests.items[0].applicantId").value(APPLICANT.toString()))
                .andExpect(jsonPath("$.data.joinRequestsAvailability").value("available"))
                .andExpect(jsonPath("$.data.wallets.villagePoints").value(1500))
                .andReturn();

        assertKeys(result, "island", "members", "constructionOptions", "joinRequests", "joinRequestsAvailability",
                "wallets", "ledger");
        JsonNode data = JSON.readTree(result.getResponse().getContentAsString()).get("data");
        assertThat(data.get("joinRequests").get("nextCursor").isNull()).isTrue();
        String cursor = data.get("members").get("nextCursor").asString();
        assertThat(DATA.receivedFor(DATA_MEMBERS).get(0).query()).contains("limit=30");

        // 화면이 준 커서를 도메인 GET 이 그대로 받는다(B10) — BFF 전용 커서가 아니다.
        mockMvc.perform(auth(get("/islands/" + ISLAND + "/members")).queryParam("cursor", cursor))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_MEMBERS).get(1).query()).contains("afterJoinedAt");
    }

    @Test
    @DisplayName("가계부: 이번 KST 달 첫 쪽을 같은 병렬 단계에서 읽고, 커서는 도메인 GET 이 이어받는다(B10)")
    void ledgerIsInTheSameParallelStep() throws Exception {
        MvcResult result = mockMvc.perform(auth(get("/screens/town-hall")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ledger.month").value(KST_MONTH))
                .andExpect(jsonPath("$.data.ledger.earnedTotal").value(4800))
                .andExpect(jsonPath("$.data.ledger.spentTotal").value(1360))
                .andExpect(jsonPath("$.data.ledger.items[0].entryCount").value(480))
                // 「누가 얼마를 넣었는가」는 도서관 게이트 뒤의 fish-earnings 몫이라 여기엔 없다.
                .andExpect(jsonPath("$.data.ledger.items[0].userId").doesNotExist())
                .andReturn();

        // 화면에는 query 가 없다 — 이번 달·방향 필터 없음·서버가 정한 limit 이다.
        assertThat(DATA.receivedFor(DATA_LEDGER).get(0).query().split("&"))
                .containsExactlyInAnyOrder("month=" + KST_MONTH, "limit=30");

        String cursor = JSON.readTree(result.getResponse().getContentAsString())
                .get("data").get("ledger").get("nextCursor").asString();
        mockMvc.perform(auth(get("/islands/" + ISLAND + "/resources/ledger"))
                        .queryParam("month", KST_MONTH).queryParam("cursor", cursor))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_LEDGER).get(1).query()).contains("afterEntryId=" + ENTRY);
    }

    @Test
    @DisplayName("가계부 조회가 실패하면 화면 전체가 실패한다 — 빈 장부나 ledger:null 로 접지 않는다")
    void ledgerFailureFailsWholeScreen() throws Exception {
        DATA.on(DATA_LEDGER, request -> domainError(403, "MEMBER_ONLY"));

        String body = mockMvc.perform(auth(get("/screens/town-hall")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.data").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("earnedTotal", "spentTotal", "ledger");
    }

    @Test
    @DisplayName("일반 주민: 신청자 목록을 부르지 않고 joinRequests:null + host_only")
    void memberSkipsJoinRequests() throws Exception {
        role("member");

        String body = mockMvc.perform(auth(get("/screens/town-hall")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.joinRequestsAvailability").value("host_only"))
                .andExpect(jsonPath("$.data.members.items[0].name").value("고양이"))
                .andReturn().getResponse().getContentAsString();

        JsonNode data = JSON.readTree(body).get("data");
        assertThat(data.has("joinRequests") && data.get("joinRequests").isNull()).isTrue();
        assertThat(DATA.hits(DATA_REQUESTS)).isZero();
    }

    @Test
    @DisplayName("역할 확인 뒤 위임돼 신청자 조회가 403 이면 화면 전체 403 — 빈 목록이나 host_only 로 접지 않는다")
    void delegatedMidReadIsForbidden() throws Exception {
        DATA.on(DATA_REQUESTS, request -> domainError(403, "NOT_OWNER"));

        String body = mockMvc.perform(auth(get("/screens/town-hall")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.field").value("islandId"))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("internal detail", "joinRequests");
    }

    @Test
    @DisplayName("모르는 역할은 계약 위반 502 — 방장 조각을 추측으로 켜거나 끄지 않는다")
    void unknownRoleIsContractError() throws Exception {
        role("owner");

        mockMvc.perform(auth(get("/screens/town-hall")))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("UPSTREAM_CONTRACT_ERROR"));
        assertThat(DATA.hits(DATA_MEMBERS) + DATA.hits(DATA_REQUESTS) + DATA.hits(DATA_OPTIONS)).isZero();
    }

    @Test
    @DisplayName("관리 게이트가 닫혀 주민 목록이 503 이면 화면 전체 503 이다")
    void membersGateClosedFailsWholeScreen() throws Exception {
        DATA.on(DATA_MEMBERS, request -> domainError(503, "ISLAND_MANAGEMENT_NOT_READY"));

        mockMvc.perform(auth(get("/screens/town-hall")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"));
    }

    @Test
    @DisplayName("query·세션 없는 토큰은 상류를 부르지 않는다")
    void rejectsBeforeTheNetwork() throws Exception {
        mockMvc.perform(auth(get("/screens/town-hall")).queryParam("cursor", "x"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/screens/town-hall").header("Authorization", "Bearer " + Tokens.access(USER)))
                .andExpect(status().isUnauthorized());
        assertThat(DATA.received()).isEmpty();
    }

    private static void role(String role) {
        DATA.on(DATA_ISLAND, request -> ok("{\"scope\":\"member\",\"visitor\":null,\"member\":{\"id\":\"" + ISLAND
                + "\",\"name\":\"모래섬\",\"intro\":\"\",\"visibility\":\"public\",\"approvalRequired\":true,"
                + "\"memberCount\":2,\"maxMembers\":15,\"membershipStatus\":\"active\",\"growthStage\":null,\"themeId\":null,"
                + "\"role\":\"" + role + "\",\"version\":3}}"));
    }
}
