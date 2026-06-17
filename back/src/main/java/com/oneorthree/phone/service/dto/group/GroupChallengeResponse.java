package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.GroupChallengeStatus;
import com.oneorthree.phone.domain.group.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;

@Getter
@Builder
public class GroupChallengeResponse {
    private Long id;
    private MissionType missionType;
    private Integer durationMinutes;
    private Instant windowStart;
    private Instant windowEnd;
    private GroupChallengeStatus status;
    private Instant createdAt;
    // TODO GROMO-358: MissionCategory missionCategory — 챌린지 카테고리 (FOCUS | SCREEN_TIME)
    // TODO GROMO-358: boolean canParticipate — FOCUS → 항상 true, SCREEN_TIME → 요청 유저의 screenTimePermissionGranted
}
