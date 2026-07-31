package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.GroupStatus;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class GroupSummaryResponse {
    UUID groupId;
    String name;
    String code;
    int currentMembers;
    int maxMembers;
    GroupMemberRole role;
    GroupStatus status;

    // 공개/비공개 — boolean isXxx 는 Jackson이 "is"를 떼고 직렬화하므로 JSON 키를 isPrivate 로 고정
    @JsonProperty("isPrivate")
    boolean isPrivate;
}
