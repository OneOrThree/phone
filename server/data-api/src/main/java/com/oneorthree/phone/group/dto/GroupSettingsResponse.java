package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.List;
import java.util.UUID;

/**
 * 그룹 설정(방장 전용) 조회 응답.
 *
 * <p>A-4(그룹 3차): 채팅 필드(chatEnabled·chatLimitPerPerson·invitePermission)는 3차 범위 밖이라
 * 계약에서 제거했다(엔티티·컬럼은 유지). 설정 화면은 공지 작성 권한 관리가 전부이므로,
 * 응답은 전 활성 멤버의 공지 권한 뷰({@link AnnouncementGrant})로 재작성됐다.
 */
@Getter
@Builder
public class GroupSettingsResponse {

    /** 전 활성 멤버의 공지 작성 권한 목록(방장 포함, 방장은 항상 granted=true·토글 불가). */
    private List<AnnouncementGrant> announcementGrants;

    @Getter
    @Builder
    public static class AnnouncementGrant {
        private UUID userId;
        private String nickname;
        private boolean granted;
    }
}
