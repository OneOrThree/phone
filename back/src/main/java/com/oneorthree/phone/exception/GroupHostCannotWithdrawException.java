package com.oneorthree.phone.exception;

public class GroupHostCannotWithdrawException extends RuntimeException {
    public GroupHostCannotWithdrawException() {
        super("방장 위임 후 탈퇴할 수 있습니다.");
    }
}
