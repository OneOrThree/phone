package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupStatus;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class GroupSearchResponse {
    private UUID groupId;
    private String name;

    // 소개(≤200자, nullable). 찾기 결과 카드에서 소개문을 노출한다(F6). 미입력 그룹은 null.
    private String description;

    private int currentMembers;
    private int maxMembers;
    private GroupStatus status;
    private boolean hasPassword;
}
