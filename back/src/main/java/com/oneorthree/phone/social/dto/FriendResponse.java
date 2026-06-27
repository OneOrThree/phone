package com.oneorthree.phone.social.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

@Getter
@Builder
public class FriendResponse {
    private UUID userId;
    private String nickname;
    private Integer tierLevel;
    private boolean isPinned;
}
