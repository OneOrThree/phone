package com.oneorthree.phone.item.dto;

import com.oneorthree.phone.item.domain.UserItem;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Builder
public class UserItemResponse {
    private UUID id;
    private ItemResponse item;
    private Instant acquiredAt;

    public static UserItemResponse from(UserItem userItem) {
        return UserItemResponse.builder()
                .id(userItem.getId())
                .item(ItemResponse.from(userItem.getItem()))
                .acquiredAt(userItem.getAcquiredAt())
                .build();
    }
}
