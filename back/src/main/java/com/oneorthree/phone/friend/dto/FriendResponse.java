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

    // 준비 시험 코드(Occupation enum name, 미설정 null) — 표시명은 앱이 /occupations 마스터로 매핑 (GROMO-747)
    private String occupation;

    // boolean isXxx 는 Jackson이 "is"를 떼고 직렬화 → JSON 키를 isPinned 로 고정
    @JsonProperty("isPinned")
    private boolean isPinned;
}
