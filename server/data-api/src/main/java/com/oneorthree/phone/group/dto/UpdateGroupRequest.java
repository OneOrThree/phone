package com.oneorthree.phone.group.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;

/**
 * 그룹 정보 부분 수정 요청(방장 전용).
 *
 * <p>모든 필드가 nullable 이고 null 은 전부 「미변경」이라, 빈 본문 요청은 아무것도 바꾸지 않고
 * 성공한다. 정원 축소는 현원(탈퇴자 제외)보다 작아지면 거절된다.
 */
@Getter
public class UpdateGroupRequest {

    /**
     * null 은 부분 수정에서 "미변경"이다. 값이 전달된 경우에만 생성 DTO와 같은 규칙을 적용한다.
     */
    @Size(max = 50)
    @Pattern(
            regexp = "^(?=.*[^\\p{javaWhitespace}\\p{Z}\\p{C}\\p{M}\\u115F\\u1160\\u2800\\u3164\\uFFA0])"
                    + "[^\\p{Cc}\\p{Zl}\\p{Zp}\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*$",
            message = "그룹명은 공백일 수 없으며 개행이나 양방향 제어문자를 사용할 수 없습니다")
    private String name;

    @Size(max = 200)
    private String description;

    @Min(1)
    @Max(10)
    private Integer maxMembers;
    /**
     * A-1: 공개/비밀 전환. null = 미변경(부분 수정).
     */
    private Boolean isPrivate;
    private PasswordAction passwordAction;
    private String password;

    /**
     * 비밀번호 잠금 조작. {@code SET} 은 {@code password} 가 함께 와야 하고 비어 있으면 400,
     * {@code REMOVE} 는 잠금을 지워 비밀번호 없이 참여할 수 있게 한다. 필드를 안 보내면 잠금은
     * 그대로다 — 공개/비공개({@code isPrivate})와는 독립된 축이다.
     */
    public enum PasswordAction {
        SET, REMOVE
    }
}
