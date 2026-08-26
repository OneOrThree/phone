package com.oneorthree.phone.item.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class GrantItemRequest {
    private UUID userId;
    private UUID itemId;
}
