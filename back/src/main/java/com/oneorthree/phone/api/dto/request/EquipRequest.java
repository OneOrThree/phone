package com.oneorthree.phone.api.dto.request;

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
