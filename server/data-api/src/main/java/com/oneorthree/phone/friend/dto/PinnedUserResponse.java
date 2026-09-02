package com.oneorthree.phone.friend.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import lombok.Builder;
import lombok.Getter;

import java.util.List;
import java.util.UUID;

/**
 * 핀한 유저의 한 건. 친구 응답과 달리 캐릭터 장착 정보까지 실어, 홈 화면이 아이템 조회를 따로 하지 않게 한다.
 */
@Getter
@Builder
public class PinnedUserResponse {
    private UUID userId;
    private String nickname;
    private List<CharacterEquipmentResponse> character;  // 장착 슬롯/아이템 표시정보
    private int focusTimeMinutes;                          // 오늘 누적 집중 분

    /**
     * boolean isXxx 는 Jackson이 "is"를 떼고 직렬화 → JSON 키를 isFocusing 으로 고정
     */
    @JsonProperty("isFocusing")
    private boolean isFocusing;                            // 현재 진행 중 FocusSession 여부
}
