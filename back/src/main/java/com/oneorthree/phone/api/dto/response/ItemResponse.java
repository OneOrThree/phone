package com.oneorthree.phone.api.dto.response;

import com.oneorthree.phone.domain.item.Item;
import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

@Getter
@Builder
public class ItemResponse {
    private UUID id;
    private String name;
    private String itemType;
    private String slotType;
    private String rarity;
    private String assetAddress;
    private String priceType;
    private Integer currencyPrice;
    private Integer premiumPrice;

    public static ItemResponse from(Item item) {
        return ItemResponse.builder()
                .id(item.getId())
                .name(item.getName())
                .itemType(item.getItemType().name())
                .slotType(item.getSlotType() != null ? item.getSlotType().name() : null)
                .rarity(item.getRarity().name())
                .assetAddress(item.getAssetAddress())
                .priceType(item.getPriceType().name())
                .currencyPrice(item.getCurrencyPrice())
                .premiumPrice(item.getPremiumPrice())
                .build();
    }
}
