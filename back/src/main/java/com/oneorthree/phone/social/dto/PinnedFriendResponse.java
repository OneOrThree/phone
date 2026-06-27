package com.oneorthree.phone.social.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import lombok.Builder;
import lombok.Getter;

import java.util.List;
import java.util.UUID;

@Getter
@Builder
public class PinnedFriendResponse {
    private UUID userId;
    private String nickname;
    private List<CharacterEquipmentResponse> character;  // 장착 슬롯/아이템 표시정보
    private int focusTimeMinutes;                          // 오늘 누적 집중 분

    // boolean isXxx 는 Jackson이 "is"를 떼고 직렬화 → JSON 키를 isFocusing 으로 고정
    @JsonProperty("isFocusing")
    private boolean isFocusing;                            // 현재 진행 중 FocusSession 여부
}
