package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.GroupStatus;
import com.oneorthree.phone.domain.group.MissionCategory;
import com.oneorthree.phone.domain.group.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.List;

@Getter
@Builder
public class GroupDetailResponse {
    private Long id;
    private String name;
    private String description;
    private MissionCategory missionCategory;
    private MissionType missionType;
    private Integer durationMinutes;
    private Instant windowStart;
    private Instant windowEnd;
    private int maxMembers;
    private GroupStatus status;
    private List<GroupDetailMemberResponse> members;
    private String code;           // nullable — OWNER에게만 반환
    private Instant codeExpiresAt; // nullable — OWNER에게만 반환
    // TODO GROMO-378: List<Long> noticeGrantedUserIds 필드 추가
    //  - 공지 작성 권한 부여된 유저 ID 목록 (OWNER 제외)
    //  - 프론트가 공지 작성/수정/삭제 버튼 노출 판단에 사용
    //  - import: java.util.List
}
