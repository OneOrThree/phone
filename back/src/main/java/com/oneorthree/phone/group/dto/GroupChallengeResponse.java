package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Builder
public class GroupChallengeResponse {
    private UUID id;
    private MissionType missionType;
    private MissionCategory missionCategory;
    private Integer durationMinutes;
    private String windowStart;
    private String windowEnd;
    private String timeZone;
    private GroupChallengeStatus status;
    private Instant createdAt;
    private boolean canParticipate;
}
