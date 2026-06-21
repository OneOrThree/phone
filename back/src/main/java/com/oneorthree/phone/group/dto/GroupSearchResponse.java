package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.group.domain.GroupStatus;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class GroupSearchResponse {
    private Long groupId;
    private String name;
    private int currentMembers;
    private int maxMembers;
    private GroupStatus status;
    private boolean hasPassword;
}
