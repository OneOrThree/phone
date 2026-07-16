package com.oneorthree.phone.friend.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
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

    // 집중 라이브 정보 (GROMO-822) — FocusLiveInfoLookup 이 상대 userId 로 배치 도출.
    // isFocusing: 현재 진행 중 세션 보유 여부(boolean isXxx → JSON 키 isFocusing 로 고정)
    @JsonProperty("isFocusing")
    private boolean isFocusing;

    // 당일 총 집중 분(초/60 내림). 집중 이력 없으면 0.
    private int focusTimeMinutes;

    // 진행 중 세션 시작 시각. 미집중이면 null.
    private Instant focusStartedAt;

    // 진행 중 세션 태그명. 태그 미지정이거나 미집중이면 null.
    private String focusTagName;
}
