package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Getter
@Builder
public class GroupDetailResponse {
    private UUID id;
    private String name;
    private String description;
    private MissionCategory missionCategory;
    private MissionType missionType;
    private Integer durationMinutes;
    private Instant windowStart;
    private Instant windowEnd;
    private int maxMembers;
    private GroupStatus status;

    // 공개/비공개 — boolean isXxx 는 Jackson이 "is"를 떼고 직렬화하므로 JSON 키를 isPrivate 로 고정
    @JsonProperty("isPrivate")
    private boolean isPrivate;

    private List<GroupDetailMemberResponse> members;
    // code/codeExpiresAt 은 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31).
    // 앱은 이 값을 화면에 노출하지 않는다. 제거하면 계약이 깨지므로 남긴다.
    private String code;           // nullable — OWNER에게만 반환
    private Instant codeExpiresAt; // nullable — OWNER에게만 반환
    private List<UUID> noticeGrantedUserIds;    //OWNER 제외
}
