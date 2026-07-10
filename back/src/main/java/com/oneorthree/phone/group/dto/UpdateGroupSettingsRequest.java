package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupPermissionScope;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class UpdateGroupSettingsRequest {
    private Boolean chatEnabled;
    private Integer chatLimitPerPerson;
    private GroupPermissionScope invitePermission;
    // 멤버 단위 공지 권한(announcement_permission) 부여 대상 — 빈 리스트 = 권한 초기화(방장만), null = 미변경
    private List<UUID> noticeGrantedUserIds;
}
