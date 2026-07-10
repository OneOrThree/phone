package com.oneorthree.phone.friend.search;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

// 전략(FriendSearchStrategy) 단계의 원시 검색 결과 — relation 미포함.
// FriendService가 relation(NONE/PENDING/FRIEND)을 채워 FriendSearchResultResponse로 변환한다.
@Getter
@Builder
public class FriendSearchResult {
    private UUID userId;
    private String nickname;
    private Integer tierLevel;

    // 준비 시험 코드(Occupation enum name, 미설정 null) — 표시명은 앱이 /occupations 마스터로 매핑 (GROMO-747)
    private String occupation;
}
