package com.oneorthree.phone.api.dto.response;

import com.oneorthree.phone.domain.UserItem;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;

@Getter
@Builder
public class UserItemResponse {
    private Long id;
    private ItemResponse item;
    private Instant acquiredAt; //todo 글로벌 타임으로 변경

    public static UserItemResponse from(UserItem userItem) {
        return UserItemResponse.builder()
                .id(userItem.getId())
                .item(ItemResponse.from(userItem.getItem()))
                .acquiredAt(userItem.getAcquiredAt())
                .build();
    }
}
