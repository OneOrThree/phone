package com.oneorthree.phone.api.dto.request;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class EquipRequest {
    private UUID userId;
    private UUID itemId;
}
