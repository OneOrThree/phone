package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Builder
public class GroupDetailMemberResponse {
    private UUID userId;
    private String nickname;
    private GroupMemberRole role;
    private Integer focusTimeMinutes;
    /**
     * A-8: 전체 누적 집중시간(분) — 그룹방 멤버 리더보드 정렬/표시용
     */
    private Integer totalFocusMinutes;

    /**
     * 집중 라이브 정보 (GROMO-1567) — FocusLiveInfoLookup 공용 도출. 의미·타입은 /league/me/ranking
     * (LeagueMemberResponse, GROMO-824)의 동명 필드와 동일하다 — 프론트가 같은 그리드에서 두 소스를 섞어 쓴다.
     * 현재 진행 중 세션 보유 여부. JSON 키 고정은 아래 명시적 getter 가 담당한다(사유는 GroupOverviewResponse#isMember).
     */
    private boolean isFocusing;

    /**
     * 진행 중 세션 시작 시각. 미집중이면 null.
     */
    private Instant focusStartedAt;

    /**
     * 진행 중 세션 태그명. 태그 미지정이거나 미집중이면 null.
     */
    private String focusTagName;

    /** {@code isFocusing} 키를 만드는 유일한 접근자 — 필드 애노테이션이면 focusing 키가 함께 나간다. */
    @JsonProperty("isFocusing")
    public boolean isFocusing() {
        return isFocusing;
    }
}
