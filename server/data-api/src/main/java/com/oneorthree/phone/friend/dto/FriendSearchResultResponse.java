package com.oneorthree.phone.friend.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

/**
 * 친구 검색 결과의 한 건. {@code relation} 이 붙어 있어야 앱이 한 목록 안에서 요청 버튼과 친구 배지를 갈라 그린다.
 */
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
