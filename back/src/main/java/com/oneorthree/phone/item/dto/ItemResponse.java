package com.oneorthree.phone.item.dto;

import com.oneorthree.phone.item.domain.Item;
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
    private String grade;
    private String assetUrl;
    private String paymentType;
    private Integer currencyPrice;
    private Integer premiumPrice;

    public static ItemResponse from(Item item) {
        return ItemResponse.builder()
                .id(item.getId())
                .name(item.getName())
                .itemType(item.getItemType().name())
                .slotType(item.getSlotType() != null ? item.getSlotType().name() : null)
                .grade(item.getGrade())
                .assetUrl(item.getAssetUrl())
                .paymentType(item.getPaymentType().name())
                .currencyPrice(item.getCurrencyPrice())
                .premiumPrice(item.getPremiumPrice())
                .build();
    }
}
