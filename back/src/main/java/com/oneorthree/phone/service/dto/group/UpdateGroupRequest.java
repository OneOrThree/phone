package com.oneorthree.phone.service.dto.group;

import lombok.Getter;

@Getter
public class UpdateGroupRequest {

    private String name;
    private Integer maxMembers;
    private PasswordAction passwordAction;
    private String password;

    public enum PasswordAction {
        SET, REMOVE
    }
}
