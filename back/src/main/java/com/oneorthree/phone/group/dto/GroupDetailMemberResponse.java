package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupMemberRole;
import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

@Getter
@Builder
public class GroupDetailMemberResponse {
    private UUID userId;
    private String nickname;
    private GroupMemberRole role;
    private Integer focusTimeMinutes;
    // A-8: 전체 누적 집중시간(분) — 그룹방 멤버 리더보드 정렬/표시용
    private Integer totalFocusMinutes;
}
