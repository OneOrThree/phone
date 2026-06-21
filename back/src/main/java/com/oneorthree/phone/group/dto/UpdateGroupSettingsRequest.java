package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.group.domain.GroupPermissionScope;
import lombok.Getter;

import java.util.List;

@Getter
public class UpdateGroupSettingsRequest {
    private Boolean chatEnabled;
    private Integer chatLimitPerPerson;
    private GroupPermissionScope noticePermission;
    private GroupPermissionScope invitePermission;
    private List<Long> noticeGrantedUserIds;    //  - 빈 리스트 = 권한 초기화(방장만), null = 미변경

}
