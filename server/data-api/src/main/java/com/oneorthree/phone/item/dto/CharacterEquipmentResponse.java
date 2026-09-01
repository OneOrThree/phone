package com.oneorthree.phone.item.dto;

import com.oneorthree.phone.item.repository.domain.CharacterEquipment;
import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

/**
 * 착용 칸 하나의 상태. 칸은 유지한 채 아이템만 비울 수 있어 {@code item} 이 null 이면
 * "그 칸을 벗어 둔 상태"를 뜻한다 — 칸 자체가 없는 것과는 다르다.
 */
@Getter
@Builder
public class CharacterEquipmentResponse {
    private UUID id;
    private String slotType;
    private ItemResponse item;  //null이면 미착용

    /**
     * 착용 엔티티를 응답 형태로 옮긴다.
     *
     * @param equip 변환할 착용 행
     * @return 칸 상태 응답. 벗어 둔 칸은 item 이 null 로 내려간다
     */
    public static CharacterEquipmentResponse from(CharacterEquipment equip) {
        return CharacterEquipmentResponse.builder()
                .id(equip.getId())
                .slotType(equip.getSlotType().name())
                .item(equip.getItem() != null ? ItemResponse.from(equip.getItem()) : null)
                .build();
    }
}
