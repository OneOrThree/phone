package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 섬 상점 Data 내부 응답 (GROMO-1781, island-shop LLD §2). 지갑·상세·구매 결과는 공개 {@code data} 와 같은 필드라
 * 그대로 내보내고, 두 목록은 Business 가 서명 커서를 붙인 공개 쪽({@code ShopUseCase})으로 옮긴다.
 * nullable 필드(가격 미승인 price, 사유, 선행 안내 등)는 {@code Nulls.FAIL} 을 달지 않는다.
 */
public final class ShopViews {

    private ShopViews() {
    }

    /** 개인 지갑엔 version 축이 없어 {@code fishVersion} 은 null 이다(Data 가 지어내지 않는다). */
    public record Wallets(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int fish,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int villagePoints,
            @JsonProperty(required = true) Long fishVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long villagePointsVersion) {
    }

    @Schema(name = "ShopCatalogItem")
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String kind,
            @JsonProperty(required = true) Integer price,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String currency,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String ownerType,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean owned,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean available,
            @JsonProperty(required = true) String reason,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int productVersion) {
    }

    /** Data 목록 한 쪽 — {@code hasMore} 면 {@code (publicationVersion, lastDisplayOrder, lastProductId)} 가 다음 경계다. */
    public record ProductPage(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items,
            @JsonProperty(required = true) Long publicationVersion,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean hasMore,
            @JsonProperty(required = true) Integer lastDisplayOrder,
            @JsonProperty(required = true) String lastProductId) {
    }

    public record RequiredProduct(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title) {
    }

    public record Product(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String kind,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title,
            @JsonProperty(required = true) Integer price,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String currency,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String ownerType,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int productVersion,
            @JsonProperty(required = true) String previewUrl,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean owned,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean available,
            @JsonProperty(required = true) String blockedReason,
            @JsonProperty(required = true) String requiredBuilding,
            @JsonProperty(required = true) RequiredProduct requiredProduct,
            @JsonProperty(required = true) String targetBuilding) {
    }

    public record Order(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String productId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int spent,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String currency,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String ownerType,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean owned,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long walletVersion) {
    }

    public record OrderItem(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String productId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int price,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String currency,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant createdAt) {
    }

    public record OrderPage(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<OrderItem> items,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean hasMore) {
    }
}
