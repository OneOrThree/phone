package com.oneorthree.phone.friend.dto;

import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Builder
public class FriendRequestResponse {
    private UUID requestId;
    private UUID userId;
    private String nickname;
    private Integer tierLevel;
    private Instant createdAt;
}
