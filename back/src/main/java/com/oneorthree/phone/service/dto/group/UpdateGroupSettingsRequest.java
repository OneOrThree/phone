package com.oneorthree.phone.service.dto.group;

import lombok.Getter;

@Getter
public class UpdateGroupSettingsRequest {
    // TODO GROMO-377: 필드 추가 (모두 nullable — PATCH, null이면 미변경)
    //  import 추가 필요: GroupPermissionScope
    //  - Boolean chatEnabled
    //  - Integer chatLimitPerPerson (null=무제한)
    //  - GroupPermissionScope noticePermission
    //  - GroupPermissionScope invitePermission

    // TODO GROMO-378: 필드 추가 (import: java.util.List)
    //  - List<Long> noticeGrantedUserIds
    //    빈 리스트 = 권한 초기화(방장만), null = 미변경
}
