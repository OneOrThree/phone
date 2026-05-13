package com.oneorthree.phone.api.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class GrantItemRequest {
    private Long userId;
    private Long itemId;
}
