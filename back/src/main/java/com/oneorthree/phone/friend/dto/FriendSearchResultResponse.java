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

    /**
     * 준비 시험 코드(Occupation enum name, 미설정 null) — 표시명은 앱이 /occupations 마스터로 매핑 (GROMO-747)
     */
    private String occupation;
    private FriendRelation relation;
}
