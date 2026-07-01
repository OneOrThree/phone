package com.oneorthree.phone.friend.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

@Getter
@Builder
public class FriendSearchResultResponse {
    private UUID userId;
    private String nickname;
    private Integer tierLevel;
    private FriendRelation relation;
}
