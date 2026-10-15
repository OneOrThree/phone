package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.repository.domain.GroupStatus;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * 그룹 찾기 결과 카드 한 장.
 *
 * <p>공개 그룹만 실린다 — 비공개 그룹은 초대 링크로만 들어오므로 검색 대상이 아니다. 검색어가 비면
 * 공개방 최신순 상위 목록이 같은 모양으로 내려간다. {@code hasPassword} 는 잠금 여부만 알려주고
 * 실제 검증은 참여 요청 때 서버가 한다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class GroupSearchResponse {
    private UUID groupId;
    private String name;

    /**
     * 소개(≤200자, nullable). 찾기 결과 카드에서 소개문을 노출한다(F6). 미입력 그룹은 null.
     */
    private String description;

    private int currentMembers;
    private int maxMembers;
    private GroupStatus status;
    private boolean hasPassword;
}
