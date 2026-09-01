package com.oneorthree.phone.group.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * 그룹 설정(방장 전용) 변경 요청.
 *
 * <p>A-4(그룹 3차): 채팅 필드는 계약에서 제거됐다. 멤버별 공지 작성 권한만 다룬다 —
 * {@code announcementGrants} 의 각 항목이 {@code granted} 대로 반영된다(항목별 upsert).
 * 목록에 없는 멤버는 미변경, 방장/비멤버 항목은 무시. null·빈 리스트 = 미변경.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class UpdateGroupSettingsRequest {

    private List<AnnouncementGrant> announcementGrants;

    /**
     * 권한을 반영할 멤버 한 명. {@code granted} 대로 부여/회수하며, 방장 id 와 이 그룹의 활성 멤버가
     * 아닌 id 는 조용히 무시된다. 같은 유저가 두 번 실리면 뒤엣것이 이긴다.
     */
    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnnouncementGrant {
        private UUID userId;
        private boolean granted;
    }
}
