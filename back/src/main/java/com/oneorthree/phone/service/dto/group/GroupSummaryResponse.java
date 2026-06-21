package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.GroupMemberRole;
import com.oneorthree.phone.domain.group.GroupStatus;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class GroupSummaryResponse {
    UUID groupId;
    String name;
    String code;
    int currentMembers;
    int maxMembers;
    GroupMemberRole role;
    GroupStatus status;
}
