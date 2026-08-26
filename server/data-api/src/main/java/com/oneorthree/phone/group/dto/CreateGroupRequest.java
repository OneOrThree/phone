package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 전체 인자 생성자를 public 으로 열지 않는다(빌더 전용, private): 공개돼 있으면 Jackson 이 그 생성자를
 * properties creator 로 잡아 미전송 primitive 파라미터를 null 로 넘기고
 * "Cannot map null into type boolean" 400 을 낸다 — isPrivate 미전송(=공개방)이 요청 거절로 이어진다.
 * 기본 생성자 + 필드 바인딩 경로를 쓰게 두고, 테스트는 빌더로 만든다.
 */
@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class CreateGroupRequest {

    @NotBlank
    @Size(max = 50)
    @Pattern(
            regexp = "^(?=.*[^\\p{javaWhitespace}\\p{Z}\\p{C}\\p{M}\\u115F\\u1160\\u2800\\u3164\\uFFA0])"
                    + "[^\\p{Cc}\\p{Zl}\\p{Zp}\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*$",
            message = "그룹명은 공백일 수 없으며 개행이나 양방향 제어문자를 사용할 수 없습니다")
    private String name;

    private String password;

    @Size(max = 200)
    private String description;

    @Min(1)
    @Max(10)
    private Integer maxMembers;

    /**
     * 공개/비공개 — 미전송이면 false(공개). 비공개 그룹은 검색에서 제외되고 초대 링크로만 참여한다.
     * boolean isXxx 는 Jackson이 "is"를 떼고 매핑 → JSON 키를 isPrivate 로 고정
     *
     * nulls = FAIL 은 "미전송"과 "명시적 null"을 갈라놓는다. 미전송은 구 앱 호환을 위해 false(공개)로
     * 두지만, "isPrivate": null 은 클라이언트 직렬화 결함이지 공개 의사가 아니다 — primitive 기본
     * coercion 에 맡기면 조용히 false 로 내려앉아 비공개로 만들려던 방이 검색 가능한 공개방이 된다.
     * (필드가 mutator 라 여기 붙인다. FAIL → InvalidNullException → HttpMessageNotReadable → 400)
     */
    @JsonProperty("isPrivate")
    @JsonSetter(nulls = Nulls.FAIL)
    private boolean isPrivate;

    // D18: 그룹 생성 시 챌린지(미션)를 정하지 않는다 — 챌린지는 그룹방에서 별도 생성한다.
    // 기존 missionType/missionCategory/durationMinutes/windowStart/windowEnd 필드는 제거됐다.
}
