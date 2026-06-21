package com.oneorthree.phone.item.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class EquipRequest {
    private Long userId;
    private Long itemId;
}
