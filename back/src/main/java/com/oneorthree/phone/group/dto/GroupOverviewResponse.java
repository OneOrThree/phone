package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Builder
public class GroupOverviewResponse {
    private UUID id;
    private String name;
    private String description;
    private MissionCategory missionCategory;
    private MissionType missionType;
    private Integer durationMinutes;
    private Instant windowStart;
    private Instant windowEnd;
    private int maxMembers;
    private int memberCount;
    private GroupStatus status;
    private boolean hasPassword;

    // 링크 프리뷰의 '이미 멤버 → 바로 그룹방' 분기가 읽는 값.
    // boolean isXxx 는 Lombok getter(isMember())를 Jackson 이 "is" 없이 매핑해 키가 member 로만 나갔다
    // → 앱의 isMember 분기가 조용히 죽으므로 키를 고정한다(레포 선례: FriendResponse.isPinned).
    // (hasPassword 는 getter 가 isHasPassword() 라 "is" 를 떼도 hasPassword 그대로다 — 고정 불필요)
    @JsonProperty("isMember")
    private boolean isMember;
}
