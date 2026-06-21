package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.GroupPermissionScope;
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
