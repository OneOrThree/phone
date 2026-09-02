package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * 내 그룹 목록의 한 줄.
 *
 * <p>{@code role} 이 함께 실려 목록에서 바로 방장 배지를 그린다. {@code code} 는 초대 링크 전환으로
 * 폐기된 참가 코드라 화면에 쓰지 않는다(계약 유지용 잔존 필드). 목록은 페이지네이션이 없고,
 * 대신 소속 그룹 수 상한이 응답 크기를 상수로 묶는다.
 */
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

    /**
     * {@code isPrivate} 키를 만드는 유일한 접근자 — 필드 애노테이션이면 private 키가 함께 나간다.
     *
     * @return 비공개 그룹이면 true — 그룹 찾기 결과에 뜨지 않는다
     */
    @JsonProperty("isPrivate")
    public boolean isPrivate() {
        return isPrivate;
    }
}
