package com.oneorthree.phone.group.dto;

import lombok.Getter;

@Getter
public class UpdateGroupRequest {

    private String name;
    private String description;
    private Integer maxMembers;
    // A-1: 공개/비밀 전환. null = 미변경(부분 수정).
    private Boolean isPrivate;
    private PasswordAction passwordAction;
    private String password;

    public enum PasswordAction {
        SET, REMOVE
    }
}
