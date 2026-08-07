package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

@Getter
@Builder
public class GroupOverviewResponse {
    private UUID id;
    private String name;
    private String description;
    private MissionCategory missionCategory;
    private MissionType missionType;
    private Integer durationMinutes;
    // 창 시각 — KST 벽시계 "HH:mm:ss" 문자열(GROMO-1206, /challenges 응답과 동일 계약).
    // 변환은 WindowFocusAggregator.timeOfDayString 단일 출구를 쓴다. 시작 ≥ 종료면 자정 걸침 창.
    private String windowStart;
    private String windowEnd;
    private int maxMembers;
    private int memberCount;
    private GroupStatus status;
    private boolean hasPassword;

    // 링크 프리뷰의 '이미 멤버 → 바로 그룹방' 분기가 읽는 값.
    // (hasPassword 는 getter 가 isHasPassword() 라 "is" 를 떼도 hasPassword 그대로다 — 고정 불필요)
    private boolean isMember;

    /**
     * {@code isMember} 키를 만드는 유일한 접근자.
     *
     * <p>Jackson 은 접근자를 <b>암묵 이름</b>으로 묶는데, is-getter 인 {@code isMember()} 의 암묵 이름은
     * "is" 를 뗀 {@code member} 다. 그래서 {@code @JsonProperty("isMember")} 를 <i>필드</i>에 달면
     * 필드(=isMember)와 getter(=member)가 서로 다른 두 프로퍼티가 되어 한 값이 두 키로 나간다.
     * 앱은 {@code isMember} 만 읽으므로 당장 깨지진 않지만, 엄격한 스키마 검증이나 생성형 클라이언트에서는
     * 미정의 필드로 실패하거나 별개 속성 두 개로 모델링된다.
     *
     * <p>getter 를 직접 선언하고 여기에만 애노테이션을 달면 프로퍼티가 하나로 접힌다 — private 필드는
     * Jackson 기본 가시성 밖이라 애노테이션이 없으면 잡히지 않기 때문이다. Lombok {@code @Getter} 는
     * 같은 이름의 메서드가 이미 있으면 생성을 건너뛴다.
     */
    @JsonProperty("isMember")
    public boolean isMember() {
        return isMember;
    }
}
