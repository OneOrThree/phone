package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.repository.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 그룹방 상세 — 그룹 메타·대표 미션·활성 멤버 목록을 한 번에 내린다.
 *
 * <p>멤버 전용 응답이라 비멤버 호출은 {@code MEMBER_ONLY} 로 막힌다. 미션 5필드는 그룹의 대표
 * 챌린지에서 뽑은 값이므로 활성 챌린지가 없으면 전부 null 이다 — 그룹 자체의 설정이 아니다.
 */
@Getter
@Builder
public class GroupDetailResponse {
    private UUID id;
    private String name;
    private String description;
    private MissionCategory missionCategory;
    private MissionType missionType;
    private Integer durationMinutes;
    /**
     * 창 시각 — KST 벽시계 "HH:mm:ss" 문자열(GROMO-1206, /challenges 응답과 동일 계약).
     * 변환은 WindowFocusAggregator.timeOfDayString 단일 출구를 쓴다. 시작 ≥ 종료면 자정 걸침 창.
     */
    private String windowStart;
    private String windowEnd;
    private int maxMembers;
    private GroupStatus status;

    /**
     * 공개/비공개. JSON 키 고정은 아래 명시적 getter 가 담당한다(사유는 GroupOverviewResponse#isMember).
     */
    private boolean isPrivate;

    private List<GroupDetailMemberResponse> members;
    /**
     * code/codeExpiresAt 은 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31).
     * 앱은 이 값을 화면에 노출하지 않는다. 제거하면 계약이 깨지므로 남긴다.
     */
    private String code;           // nullable — OWNER에게만 반환
    private Instant codeExpiresAt; // nullable — OWNER에게만 반환
    private List<UUID> noticeGrantedUserIds;    //OWNER 제외

    /**
     * {@code isPrivate} 키를 만드는 유일한 접근자 — 필드 애노테이션이면 private 키가 함께 나간다.
     *
     * @return 비공개 그룹이면 true — 그룹 찾기 결과에서 빠지고 초대 링크로만 참여한다.
     *     비밀번호 잠금과는 별개 축이라 둘 다 켜거나 한쪽만 켤 수 있다.
     */
    @JsonProperty("isPrivate")
    public boolean isPrivate() {
        return isPrivate;
    }
}
