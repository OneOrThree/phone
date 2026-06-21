package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupPermissionScope;
import lombok.Builder;
import lombok.Getter;

import java.util.List;

@Getter
@Builder
public class GroupSettingsResponse {
    private boolean chatEnabled;
    private Integer chatLimitPerPerson;
    private GroupPermissionScope noticePermission;
    private GroupPermissionScope invitePermission;
    private List<Long> noticeGrantedUserIds;
}
