package com.oneorthree.phone.group.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;

@Getter
public class UpdateGroupRequest {

    // null 은 부분 수정에서 "미변경"이다. 값이 전달된 경우에만 생성 DTO와 같은 규칙을 적용한다.
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
    // A-1: 공개/비밀 전환. null = 미변경(부분 수정).
    private Boolean isPrivate;
    private PasswordAction passwordAction;
    private String password;

    public enum PasswordAction {
        SET, REMOVE
    }
}
