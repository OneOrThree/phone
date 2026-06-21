package com.oneorthree.phone.group.dto;

import lombok.Getter;

@Getter
public class UpdateGroupRequest {

    private String name;
    private String description;
    private Integer maxMembers;
    private PasswordAction passwordAction;
    private String password;

    public enum PasswordAction {
        SET, REMOVE
    }
}
