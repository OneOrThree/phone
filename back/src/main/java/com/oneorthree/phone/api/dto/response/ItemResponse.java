package com.oneorthree.phone.api.dto.response;

import com.oneorthree.phone.domain.Item;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class ItemResponse {
    private Long id;
    private String name;
    private String description;
    private String assetAddress;
    private String thumbnailUrl;
    private String slotType;
    private String rarity;

    public static ItemResponse from(Item item) {
        return ItemResponse.builder()
                .id(item.getId())
                .name(item.getName())
                .description(item.getDescription())
                .assetAddress(item.getAssetAddress())
                .thumbnailUrl(item.getThumbnailUrl())
                .slotType(item.getSlotType().name())
                .rarity(item.getRarity().name())
                .build();
    }
}
