package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
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
    private List<Long> noticeGrantedUserIds;    //OWNER 제외
}
