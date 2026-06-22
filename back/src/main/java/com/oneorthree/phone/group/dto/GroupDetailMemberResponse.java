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
}
