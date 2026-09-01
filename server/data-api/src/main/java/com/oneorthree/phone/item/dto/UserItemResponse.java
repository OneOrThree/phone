package com.oneorthree.phone.item.dto;

import com.oneorthree.phone.item.repository.domain.UserItem;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

/**
 * 보유 아이템 한 줄. {@code createdAt} 은 아이템이 만들어진 때가 아니라 이 유저가 그것을
 * 손에 넣은 때다. 착용 중인지 여부는 담지 않는다.
 */
@Getter
@Builder
public class UserItemResponse {
    private UUID id;
    private ItemResponse item;
    private Instant createdAt;

    /**
     * 보유 엔티티를 응답 형태로 옮긴다.
     *
     * @param userItem 변환할 보유 행
     * @return 보유 응답. id 는 아이템 id 가 아니라 보유 기록 자체의 id 다
     */
    public static UserItemResponse from(UserItem userItem) {
        return UserItemResponse.builder()
                .id(userItem.getId())
                .item(ItemResponse.from(userItem.getItem()))
                .createdAt(userItem.getCreatedAt())
                .build();
    }
}
