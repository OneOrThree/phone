package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.GroupStatus;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class GroupSearchResponse {
    private UUID groupId;
    private String name;
    private int currentMembers;
    private int maxMembers;
    private GroupStatus status;
    private boolean hasPassword;
}
