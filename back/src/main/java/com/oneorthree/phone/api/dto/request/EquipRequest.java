package com.oneorthree.phone.api.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class EquipRequest {
    private Long userId;
    private Long itemId;
}
