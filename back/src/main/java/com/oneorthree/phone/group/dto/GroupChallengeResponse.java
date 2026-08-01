package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.List;
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
    private GroupChallengeStatus status;
    private Instant createdAt;
    private boolean canParticipate;

    /**
     * 멤버별 당일 진행률. 조회 시 {@code date} 를 주지 않았거나 TIME_WINDOW 챌린지, 또는 이미 끝난
     * 챌린지({@code status = INACTIVE})면 null 이다
     * (하위 호환: 기존 클라이언트는 date 를 보내지 않으므로 필드가 항상 null 로 나간다).
     */
    private List<ChallengeMemberProgressResponse> memberProgress;
}
