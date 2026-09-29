package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.ShopViews;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.time.Instant;
import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.islandPath;

/** 섬 상점 5종의 Data 호출 (GROMO-1781) — 섬 축 공개 경로 그대로 `/internal` 아래다. */
public class DataShopClient {

    private static final String PATH_SHOP_WALLETS = "/internal/islands/{islandId}/shop/wallets";
    private static final String PATH_SHOP_PRODUCTS = "/internal/islands/{islandId}/shop/products";
    private static final String PATH_SHOP_ORDERS = "/internal/islands/{islandId}/shop/orders";

    private final InternalHttpClient http;

    public DataShopClient(InternalHttpClient http) {
        this.http = http;
    }

    /** 상점 지갑 두 개 (GROMO-1781) — 활성 주민 전용. 멱등 GET 이라 재시도한다. */
    public ShopViews.Wallets fetchShopWallets(UUID userId, UUID islandId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SHOP_WALLETS, islandId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.Wallets>() { });
    }

    /**
     * 상점 카탈로그 한 쪽 (GROMO-1781). 경계 세 값은 서명 커서를 푼 이전 쪽의 발행본·마지막 정렬키다 — 첫 쪽은
     * 싣지 않는다. owned/available 판정은 전부 상류 몫이다.
     */
    public ShopViews.ProductPage fetchShopProducts(UUID userId, UUID islandId, String category,
            Long publicationVersion, Integer afterDisplayOrder, String afterProductId, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SHOP_PRODUCTS, islandId))
                        .onBehalfOf(userId)
                        .query("category", category)
                        .query("publicationVersion", publicationVersion == null ? null : publicationVersion.toString())
                        .query("afterDisplayOrder", afterDisplayOrder == null ? null : afterDisplayOrder.toString())
                        .query("afterProductId", afterProductId)
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.ProductPage>() { });
    }

    /** 상품 상세 (GROMO-1781). productId 는 공개 경계가 안전 문자로 거른 카탈로그 문자열이다. */
    public ShopViews.Product fetchShopProduct(UUID userId, UUID islandId, String productId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SHOP_PRODUCTS, islandId) + "/" + productId)
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.Product>() { });
    }

    /**
     * 구매 (GROMO-1781). 두 version 은 «사용자가 본 가격·잔액»의 동의 증거다. 앱 키를 그대로 전달해 응답 유실
     * 복구는 Data 의 receipt 재생이다 — 가격·통화·주인은 보내지 않는다(서버가 판매 revision 에서 정한다).
     */
    public ShopViews.Order purchaseShopProduct(UUID userId, UUID islandId, String productId,
            long expectedWalletVersion, long expectedProductVersion, UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, islandPath(PATH_SHOP_ORDERS, islandId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new ShopOrderCommand(productId, expectedWalletVersion, expectedProductVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.Order>() { });
    }

    /** 섬 귀속 구매 내역 (GROMO-1781, BG18). anchor 두 값은 서명 커서를 푼 이전 쪽의 마지막 행이다. */
    public ShopViews.OrderPage fetchShopOrders(UUID userId, UUID islandId, String scope, Instant afterCreatedAt,
            UUID afterId, int limit, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, islandPath(PATH_SHOP_ORDERS, islandId))
                        .onBehalfOf(userId)
                        .query("scope", scope)
                        .query("afterCreatedAt", afterCreatedAt == null ? null : afterCreatedAt.toString())
                        .query("afterId", afterId == null ? null : afterId.toString())
                        .query("limit", Integer.toString(limit))
                        .build(),
                deadline,
                new ParameterizedTypeReference<ShopViews.OrderPage>() { });
    }

    /** 건설 시작 요청 본문 (GROMO-1767). 두 버전 필드가 모두 필수다(LLD §2). */
    record ShopOrderCommand(String productId, long expectedWalletVersion, long expectedProductVersion) {
    }
}
