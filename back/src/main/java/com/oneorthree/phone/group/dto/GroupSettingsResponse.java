package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupPermissionScope;
import lombok.Builder;
import lombok.Getter;

import java.util.List;
import java.util.UUID;

@Getter
@Builder
public class GroupSettingsResponse {
    private boolean chatEnabled;
    private Integer chatLimitPerPerson;
    private GroupPermissionScope noticePermission;
    private GroupPermissionScope invitePermission;
    private List<UUID> noticeGrantedUserIds;
}
