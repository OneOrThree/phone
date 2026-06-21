package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;

@Getter
@Builder
public class GroupOverviewResponse {
    private Long id;
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
    private boolean isMember;
}
