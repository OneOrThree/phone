package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.GroupStatus;
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
