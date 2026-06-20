package com.oneorthree.phone.service.dto.group;

import lombok.Getter;

@Getter
public class UpdateGroupRequest {

    // TODO GROMO-377: String description 필드 추가 (null=미변경)
    private String name;
    private Integer maxMembers;
    private PasswordAction passwordAction;
    private String password;

    public enum PasswordAction {
        SET, REMOVE
    }
}
