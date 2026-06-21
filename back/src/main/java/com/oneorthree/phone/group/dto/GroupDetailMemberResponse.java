package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.group.domain.GroupMemberRole;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class GroupDetailMemberResponse {
    private Long userId;
    private String nickname;
    private GroupMemberRole role;
    private Integer focusTimeMinutes;
}
