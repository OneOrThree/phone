package com.oneorthree.business.api;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.business.support.MockUpstream;
import com.oneorthree.business.support.Tokens;
import com.oneorthree.business.support.UpstreamTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 상점 공개 5종의 계약 (GROMO-1781) — 실제 필터·컨트롤러·TCP 클라이언트로 경계만 본다. 원자 차감·지급·멱등은
 * data-api 의 {@code ShopServiceIntegrationTest} 가 본다.
 */
class ShopContractTest extends UpstreamTestBase {

    private static final UUID USER = UUID.fromString("aaaaaaaa-1781-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("bbbbbbbb-1781-0000-0000-000000000001");
    private static final UUID ISLAND = UUID.fromString("cccccccc-1781-0000-0000-000000000001");
    private static final UUID ORDER = UUID.fromString("01990000-1781-7000-8000-000000000001");
    private static final String KEY = "eeeeeeee-1781-5000-8000-000000000001";

    private static final String INTERNAL = "/internal/islands/" + ISLAND + "/shop";
    private static final String DATA_WALLETS = "GET " + INTERNAL + "/wallets";
    private static final String DATA_PRODUCTS = "GET " + INTERNAL + "/products";
    private static final String DATA_PRODUCT = "GET " + INTERNAL + "/products/rain";
    private static final String DATA_BUY = "POST " + INTERNAL + "/orders";
    private static final String DATA_ORDERS = "GET " + INTERNAL + "/orders";

    private static final String PUBLIC = "/islands/" + ISLAND + "/shop";
    private static final String BUY_BODY = "{\"productId\":\"rain\",\"expectedWalletVersion\":7,"
            + "\"expectedProductVersion\":5}";

    private static final String WALLETS = "{\"fish\":500,\"villagePoints\":1500,\"fishVersion\":null,"
            + "\"villagePointsVersion\":7}";
    private static final String PRODUCT = "{\"id\":\"rain\",\"kind\":\"audio\",\"title\":\"오두막의 빗소리\","
            + "\"price\":30,\"currency\":\"village_points\",\"ownerType\":\"island\",\"productVersion\":5,"
            + "\"previewUrl\":null,\"owned\":false,\"available\":true,\"blockedReason\":null,"
            + "\"requiredBuilding\":\"gram\",\"requiredProduct\":null,\"targetBuilding\":null}";
    private static final String ORDER_BODY = "{\"id\":\"" + ORDER + "\",\"productId\":\"rain\",\"spent\":30,"
            + "\"currency\":\"village_points\",\"ownerType\":\"island\",\"owned\":true,\"walletVersion\":8}";
    private static final String UNPRICED_PAGE = "{\"items\":[{\"id\":\"scarf\",\"title\":\"바다 스카프\","
            + "\"kind\":\"clothes\",\"price\":null,\"currency\":\"village_points\",\"ownerType\":\"user\","
            + "\"owned\":false,\"available\":false,\"reason\":\"STATE_CONFLICT\",\"productVersion\":1}],"
            + "\"publicationVersion\":3,\"hasMore\":true,\"lastDisplayOrder\":10,\"lastProductId\":\"scarf\"}";
    private static final String ORDERS_PAGE = "{\"items\":[{\"id\":\"" + ORDER + "\",\"productId\":\"rain\","
            + "\"price\":30,\"currency\":\"village_points\",\"createdAt\":\"2026-09-19T01:02:03.123456Z\"}],"
            + "\"hasMore\":true}";

    // ---------------------------------------------------------------- 구매

    @Test
    @DisplayName("구매는 201 이고 서명된 주체·앱 키·세 필드 본문만 상류로 옮긴다 — 공격자 X-User-Id 는 버린다")
    void purchaseForwardsOnlyTheSignedSubjectAndThreeFields() throws Exception {
        DATA.on(DATA_BUY, request -> new MockUpstream.Response(201, ORDER_BODY));

        mockMvc.perform(write(post(PUBLIC + "/orders"), BUY_BODY).header("X-User-Id", UUID.randomUUID()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(ORDER.toString()))
                .andExpect(jsonPath("$.data.spent").value(30))
                .andExpect(jsonPath("$.data.currency").value("village_points"))
                .andExpect(jsonPath("$.data.walletVersion").value(8));

        MockUpstream.RecordedRequest forwarded = DATA.receivedFor(DATA_BUY).get(0);
        assertThat(forwarded.header("X-User-Id")).isEqualTo(USER.toString());
        assertThat(forwarded.header("Idempotency-Key")).isEqualTo(KEY);
        assertThat(forwarded.body()).isEqualTo(BUY_BODY);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{\"productId\":\"rain\",\"expectedWalletVersion\":7,\"expectedProductVersion\":5,\"price\":0}",
            "{\"productId\":\"rain\",\"expectedWalletVersion\":7}",
            "{\"productId\":7,\"expectedWalletVersion\":7,\"expectedProductVersion\":5}",
            "{\"productId\":\"rain\",\"expectedWalletVersion\":1.5,\"expectedProductVersion\":5}"})
    @DisplayName("가격·수량 등 미등록 필드, 누락, 타입 오류는 400 — 상류를 부르지 않는다")
    void rejectsMalformedPurchaseBodies(String body) throws Exception {
        mockMvc.perform(write(post(PUBLIC + "/orders"), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
        assertThat(DATA.received()).isEmpty();
    }

    @Test
    @DisplayName("Idempotency-Key 가 없으면 400 INVALID_IDEMPOTENCY_KEY")
    void purchaseRequiresCommandKey() throws Exception {
        mockMvc.perform(auth(post(PUBLIC + "/orders")).contentType(MediaType.APPLICATION_JSON).content(BUY_BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_IDEMPOTENCY_KEY"));
        assertThat(DATA.received()).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"403,MEMBER_ONLY,403,FORBIDDEN,islandId",
            "403,SHOP_FORBIDDEN,403,FORBIDDEN,",
            "403,FACILITY_LOCKED,403,FACILITY_LOCKED,",
            "404,PRODUCT_NOT_FOUND,404,PRODUCT_NOT_FOUND,productId",
            "404,GROUP_NOT_FOUND,404,GROUP_NOT_FOUND,islandId",
            "409,STATE_CONFLICT,409,STATE_CONFLICT,productId",
            "409,INSUFFICIENT_FUNDS,409,INSUFFICIENT_FUNDS,productId",
            "409,IDEMPOTENCY_KEY_CONFLICT,409,IDEMPOTENCY_KEY_REUSED,Idempotency-Key",
            "409,SHOP_FORBIDDEN,400,UPSTREAM_CONTRACT_ERROR,",
            "400,UNKNOWN_SHOP_ERROR,400,UPSTREAM_CONTRACT_ERROR,"})
    @DisplayName("정확히 같은 (상태, 코드) 쌍만 공개 오류로 옮기고 나머지는 400 다")
    void mapsOnlyExactDomainStatusAndCode(int upstreamStatus, String code, int publicStatus, String publicCode,
            String field) throws Exception {
        DATA.on(DATA_BUY, request -> error(upstreamStatus, code));

        MvcResult result = mockMvc.perform(write(post(PUBLIC + "/orders"), BUY_BODY))
                .andExpect(status().is(publicStatus))
                .andExpect(jsonPath("$.error.code").value(publicCode))
                .andExpect(jsonPath("$.error.field").value(field)).andReturn();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("private detail");
    }

    @Test
    @DisplayName("가격이 바뀐 VERSION_CONFLICT 는 field=expectedProductVersion 과 최신 상품 상세를 current 로 준다")
    void productVersionConflictCarriesCurrentProduct() throws Exception {
        DATA.on(DATA_BUY, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_PRODUCT, request -> ok(PRODUCT.replace("\"productVersion\":5", "\"productVersion\":6")));

        mockMvc.perform(write(post(PUBLIC + "/orders"), BUY_BODY))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.error.field").value("expectedProductVersion"))
                .andExpect(jsonPath("$.current.version").value(6))
                .andExpect(jsonPath("$.current.resource.price").value(30));
    }

    @Test
    @DisplayName("상품이 그대로면 충돌 축은 지갑이다 — field=expectedWalletVersion, current 는 지갑")
    void walletVersionConflictCarriesCurrentWallets() throws Exception {
        DATA.on(DATA_BUY, request -> error(409, "VERSION_CONFLICT"));
        DATA.on(DATA_PRODUCT, request -> ok(PRODUCT));
        DATA.on(DATA_WALLETS, request -> ok(WALLETS.replace("\"villagePointsVersion\":7",
                "\"villagePointsVersion\":9")));

        mockMvc.perform(write(post(PUBLIC + "/orders"), BUY_BODY))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.field").value("expectedWalletVersion"))
                .andExpect(jsonPath("$.current.version").value(9))
                .andExpect(jsonPath("$.current.resource.villagePoints").value(1500));
    }

    // ---------------------------------------------------------------- 조회

    @Test
    @DisplayName("지갑은 상류 그대로 — 개인 지갑 version 은 null 로 두고 지어내지 않는다")
    void walletsPassThrough() throws Exception {
        DATA.on(DATA_WALLETS, request -> ok(WALLETS));

        mockMvc.perform(auth(get(PUBLIC + "/wallets")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.villagePoints").value(1500))
                .andExpect(jsonPath("$.data.villagePointsVersion").value(7))
                .andExpect(jsonPath("$.data.fishVersion").value(nullValue()));
    }

    @Test
    @DisplayName("목록: 미승인 가격은 null·available=false 그대로, 다음 쪽 커서가 발행본·정렬키를 되돌려 싣는다")
    void productsPageAndCursorRoundTrip() throws Exception {
        DATA.on(DATA_PRODUCTS, request -> ok(UNPRICED_PAGE));

        MvcResult first = mockMvc.perform(auth(get(PUBLIC + "/products")).queryParam("category", "personal"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].price").value(nullValue()))
                .andExpect(jsonPath("$.data.items[0].available").value(false))
                .andExpect(jsonPath("$.data.items[0].reason").value("STATE_CONFLICT"))
                .andExpect(jsonPath("$.data.nextCursor").isString())
                .andReturn();
        assertThat(DATA.receivedFor(DATA_PRODUCTS).get(0).query().split("&"))
                .containsExactlyInAnyOrder("category=personal", "limit=30");

        String cursor = JsonPath.read(first.getResponse().getContentAsString(), "$.data.nextCursor");
        mockMvc.perform(auth(get(PUBLIC + "/products")).queryParam("category", "personal")
                        .queryParam("cursor", cursor))
                .andExpect(status().isOk());
        assertThat(DATA.receivedFor(DATA_PRODUCTS).get(1).query().split("&"))
                .containsExactlyInAnyOrder("category=personal", "publicationVersion=3",
                        "afterDisplayOrder=10", "afterProductId=scarf", "limit=30");

        // 다른 category 로 옮긴 커서는 scope 가 달라 400 이다.
        mockMvc.perform(auth(get(PUBLIC + "/products")).queryParam("category", "island")
                        .queryParam("cursor", cursor))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_CURSOR"));
    }

    @Test
    @DisplayName("목록 입력 — category 누락 400, category·scope·limit 범위 밖 422, 발행본 폐기는 409 CURSOR_EXPIRED")
    void productsInputValidation() throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "/products")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("category"));
        mockMvc.perform(auth(get(PUBLIC + "/products")).queryParam("category", "island").queryParam("limit", "0"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("limit"));
        mockMvc.perform(auth(get(PUBLIC + "/products")).queryParam("category", "hull"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("category"));
        mockMvc.perform(auth(get(PUBLIC + "/orders")).queryParam("scope", "all"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.field").value("scope"));
        assertThat(DATA.received()).isEmpty();

        DATA.on(DATA_PRODUCTS, request -> error(409, "CURSOR_EXPIRED"));
        mockMvc.perform(auth(get(PUBLIC + "/products")).queryParam("category", "island"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CURSOR_EXPIRED"));
    }

    @Test
    @DisplayName("상세는 상류 그대로, 경로의 productId 가 카탈로그 문자로 안 되면 부르지 않고 404")
    void productDetail() throws Exception {
        DATA.on(DATA_PRODUCT, request -> ok(PRODUCT));

        mockMvc.perform(auth(get(PUBLIC + "/products/rain")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.requiredBuilding").value("gram"))
                .andExpect(jsonPath("$.data.productVersion").value(5));
        mockMvc.perform(auth(get(PUBLIC + "/products/a%20b")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("PRODUCT_NOT_FOUND"));
        assertThat(DATA.hits(DATA_PRODUCT)).isOne();
    }

    @Test
    @DisplayName("내역: scope 누락 400, 다음 쪽 커서가 (createdAt, id) 경계를 되돌려 싣는다")
    void ordersPageAndCursor() throws Exception {
        mockMvc.perform(auth(get(PUBLIC + "/orders")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("scope"));
        DATA.on(DATA_ORDERS, request -> ok(ORDERS_PAGE));

        MvcResult first = mockMvc.perform(auth(get(PUBLIC + "/orders")).queryParam("scope", "shared"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].price").value(30))
                .andExpect(jsonPath("$.data.nextCursor").isString())
                .andReturn();
        String cursor = JsonPath.read(first.getResponse().getContentAsString(), "$.data.nextCursor");
        mockMvc.perform(auth(get(PUBLIC + "/orders")).queryParam("scope", "shared").queryParam("cursor", cursor))
                .andExpect(status().isOk());

        assertThat(DATA.receivedFor(DATA_ORDERS).get(0).query().split("&"))
                .containsExactlyInAnyOrder("scope=shared", "limit=30");
        assertThat(DATA.receivedFor(DATA_ORDERS).get(1).query().split("&"))
                .containsExactlyInAnyOrder("scope=shared", "afterCreatedAt=2026-09-19T01:02:03.123456Z",
                        "afterId=" + ORDER, "limit=30");
    }

    // ---------------------------------------------------------------- 도구

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + Tokens.accessWithSession(USER, 3, SESSION));
    }

    private MockHttpServletRequestBuilder write(MockHttpServletRequestBuilder request, String body) {
        return auth(request).header("Idempotency-Key", KEY).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static MockUpstream.Response ok(String body) {
        return new MockUpstream.Response(200, body);
    }

    private static MockUpstream.Response error(int status, String code) {
        return new MockUpstream.Response(status, "{\"code\":\"" + code + "\",\"message\":\"private detail\"}");
    }
}
