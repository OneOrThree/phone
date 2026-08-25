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

    /**
     * 소개(≤200자, nullable). 목록/찾기 카드에서 소개문을 노출한다(F6). 미입력 그룹은 null.
     */
    String description;

    String code;
    int currentMembers;
    int maxMembers;
    GroupMemberRole role;
    GroupStatus status;

    // 공개/비공개. JSON 키 고정은 아래 명시적 getter 가 담당한다(사유는 GroupOverviewResponse#isMember).
    boolean isPrivate;

    /** {@code isPrivate} 키를 만드는 유일한 접근자 — 필드 애노테이션이면 private 키가 함께 나간다. */
    @JsonProperty("isPrivate")
    public boolean isPrivate() {
        return isPrivate;
    }
}
