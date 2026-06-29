package com.oneorthree.phone.friend.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

@Getter
@Builder
public class FriendResponse {
    private UUID userId;
    private String nickname;
    private Integer tierLevel;

    // boolean isXxx 는 Jackson이 "is"를 떼고 직렬화 → JSON 키를 isPinned 로 고정
    @JsonProperty("isPinned")
    private boolean isPinned;
}
