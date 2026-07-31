package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

// 전체 인자 생성자를 public 으로 열지 않는다(빌더 전용, private): 공개돼 있으면 Jackson 이 그 생성자를
// properties creator 로 잡아 미전송 primitive 파라미터를 null 로 넘기고
// "Cannot map null into type boolean" 400 을 낸다 — isPrivate 미전송(=공개방)이 요청 거절로 이어진다.
// 기본 생성자 + 필드 바인딩 경로를 쓰게 두고, 테스트는 빌더로 만든다.
@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class CreateGroupRequest {

    @NotBlank
    @Size(max = 50)
    private String name;

    private String password;

    @Size(max = 200)
    private String description;

    @Min(1)
    @Max(10)
    private Integer maxMembers;

    // 공개/비공개 — 미전송이면 false(공개). 비공개 그룹은 검색에서 제외되고 초대 링크로만 참여한다.
    // boolean isXxx 는 Jackson이 "is"를 떼고 매핑 → JSON 키를 isPrivate 로 고정
    @JsonProperty("isPrivate")
    private boolean isPrivate;

    @NotNull
    private MissionType missionType;

    @NotNull
    private MissionCategory missionCategory;

    private Integer durationMinutes;
    private Instant windowStart;
    private Instant windowEnd;
}
