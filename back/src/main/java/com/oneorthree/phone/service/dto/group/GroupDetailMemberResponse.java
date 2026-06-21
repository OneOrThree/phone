package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.GroupMemberRole;
import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

@Getter
@Builder
public class GroupDetailMemberResponse {
    private UUID userId;
    private String nickname;
    private GroupMemberRole role;
}
