package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.ShopViews;

import java.time.Instant;
import java.util.UUID;

/** 공개 필드만 명시적으로 조립한다. 내부 전송 DTO의 확장이 응답에 섞이지 않도록 분리한다. */
public final class ShopResponses {

    private ShopResponses() {
    }

    public record ShopWallets(
            @JsonProperty(required = true) int fish,
            @JsonProperty(required = true) int villagePoints,
            @JsonProperty(required = true) Long fishVersion,
            @JsonProperty(required = true) long villagePointsVersion) {
        public static ShopWallets from(ShopViews.Wallets value) {
            if (value == null) {
                return null;
            }
            return new ShopWallets(
                    value.fish(),
                    value.villagePoints(),
                    value.fishVersion(),
                    value.villagePointsVersion());
        }
    }

    public record ShopCatalogItem(
            @JsonProperty(required = true) String id,
            @JsonProperty(required = true) String title,
            @JsonProperty(required = true) String kind,
            @JsonProperty(required = true) Integer price,
            @JsonProperty(required = true) String currency,
            @JsonProperty(required = true) String ownerType,
            @JsonProperty(required = true) boolean owned,
            @JsonProperty(required = true) boolean available,
            @JsonProperty(required = true) String reason,
            @JsonProperty(required = true) int productVersion) {
        public static ShopCatalogItem from(ShopViews.Item value) {
            if (value == null) {
                return null;
            }
            return new ShopCatalogItem(
                    value.id(),
                    value.title(),
                    value.kind(),
                    value.price(),
                    value.currency(),
                    value.ownerType(),
                    value.owned(),
                    value.available(),
                    value.reason(),
                    value.productVersion());
        }
    }

    public record ShopRequiredProduct(
            @JsonProperty(required = true) String id,
            @JsonProperty(required = true) String title) {
        public static ShopRequiredProduct from(ShopViews.RequiredProduct value) {
            if (value == null) {
                return null;
            }
            return new ShopRequiredProduct(
                    value.id(),
                    value.title());
        }
    }

    public record ShopProduct(
            @JsonProperty(required = true) String id,
            @JsonProperty(required = true) String kind,
            @JsonProperty(required = true) String title,
            @JsonProperty(required = true) Integer price,
            @JsonProperty(required = true) String currency,
            @JsonProperty(required = true) String ownerType,
            @JsonProperty(required = true) int productVersion,
            @JsonProperty(required = true) String previewUrl,
            @JsonProperty(required = true) boolean owned,
            @JsonProperty(required = true) boolean available,
            @JsonProperty(required = true) String blockedReason,
            @JsonProperty(required = true) String requiredBuilding,
            @JsonProperty(required = true) ShopRequiredProduct requiredProduct,
            @JsonProperty(required = true) String targetBuilding) {
        public static ShopProduct from(ShopViews.Product value) {
            if (value == null) {
                return null;
            }
            return new ShopProduct(
                    value.id(),
                    value.kind(),
                    value.title(),
                    value.price(),
                    value.currency(),
                    value.ownerType(),
                    value.productVersion(),
                    value.previewUrl(),
                    value.owned(),
                    value.available(),
                    value.blockedReason(),
                    value.requiredBuilding(),
                    ShopRequiredProduct.from(value.requiredProduct()),
                    value.targetBuilding());
        }
    }

    public record ShopOrder(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) String productId,
            @JsonProperty(required = true) int spent,
            @JsonProperty(required = true) String currency,
            @JsonProperty(required = true) String ownerType,
            @JsonProperty(required = true) boolean owned,
            @JsonProperty(required = true) long walletVersion) {
        public static ShopOrder from(ShopViews.Order value) {
            if (value == null) {
                return null;
            }
            return new ShopOrder(
                    value.id(),
                    value.productId(),
                    value.spent(),
                    value.currency(),
                    value.ownerType(),
                    value.owned(),
                    value.walletVersion());
        }
    }

    public record ShopOrderItem(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) String productId,
            @JsonProperty(required = true) int price,
            @JsonProperty(required = true) String currency,
            @JsonProperty(required = true) Instant createdAt) {
        public static ShopOrderItem from(ShopViews.OrderItem value) {
            if (value == null) {
                return null;
            }
            return new ShopOrderItem(
                    value.id(),
                    value.productId(),
                    value.price(),
                    value.currency(),
                    value.createdAt());
        }
    }
}
