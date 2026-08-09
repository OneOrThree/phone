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
    // 창 시각 — KST 벽시계 "HH:mm:ss" 문자열(GROMO-1206, /challenges 응답과 동일 계약).
    // 변환은 WindowFocusAggregator.timeOfDayString 단일 출구를 쓴다. 항상 시작 < 종료다(정책 §A6-1).
    private String windowStart;
    private String windowEnd;
    private int maxMembers;
    private GroupStatus status;

    // 공개/비공개. JSON 키 고정은 아래 명시적 getter 가 담당한다(사유는 GroupOverviewResponse#isMember).
    private boolean isPrivate;

    private List<GroupDetailMemberResponse> members;
    // code/codeExpiresAt 은 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31).
    // 앱은 이 값을 화면에 노출하지 않는다. 제거하면 계약이 깨지므로 남긴다.
    private String code;           // nullable — OWNER에게만 반환
    private Instant codeExpiresAt; // nullable — OWNER에게만 반환
    private List<UUID> noticeGrantedUserIds;    //OWNER 제외

    /** {@code isPrivate} 키를 만드는 유일한 접근자 — 필드 애노테이션이면 private 키가 함께 나간다. */
    @JsonProperty("isPrivate")
    public boolean isPrivate() {
        return isPrivate;
    }
}
