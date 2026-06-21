package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.GroupPermissionScope;
import lombok.Getter;

@Getter
public class UpdateGroupSettingsRequest {
    private Boolean chatEnabled;
    private Integer chatLimitPerPerson;
    private GroupPermissionScope noticePermission;
    private GroupPermissionScope invitePermission;

    // TODO GROMO-378: List<Long> noticeGrantedUserIds 필드 추가
    //  - 빈 리스트 = 권한 초기화(방장만), null = 미변경
}
