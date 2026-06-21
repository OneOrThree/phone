package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.GroupChallengeStatus;
import com.oneorthree.phone.domain.group.MissionCategory;
import com.oneorthree.phone.domain.group.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Builder
public class GroupChallengeResponse {
    // TODO GROMO-370: windowStart / windowEnd 의 날짜를 제거하고 시간만 반환
    //  - 현재 Instant 타입을 String 타입("HH:mm:ss" 포맷)으로 변경
    //  - 변환 기준 타임존은 GroupChallenge.timeZone 사용 (없으면 UTC)
    //  - DURATION 미션은 windowStart/windowEnd가 null → null 그대로 통과
    private UUID id;
    private MissionType missionType;
    private MissionCategory missionCategory;
    private Integer durationMinutes;
    private Instant windowStart;
    private Instant windowEnd;
    private GroupChallengeStatus status;
    private Instant createdAt;
    private boolean canParticipate;
}
