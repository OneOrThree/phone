package com.oneorthree.phone.api.dto.response;

import com.oneorthree.phone.domain.CharacterEquipment;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class CharacterEquipmentResponse {
    private Long id;
    private String slotType;
    private ItemResponse item;  //null이면 미착용

    public static CharacterEquipmentResponse from(CharacterEquipment equip) {
        return CharacterEquipmentResponse.builder()
                .id(equip.getId())
                .slotType(equip.getSlotType().name())
                .item(equip.getItem() != null ? ItemResponse.from(equip.getItem()) : null)
                .build();
    }
}
