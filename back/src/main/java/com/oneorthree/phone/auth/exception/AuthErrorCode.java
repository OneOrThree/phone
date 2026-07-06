package com.oneorthree.phone.auth.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum AuthErrorCode {

    // 게스트가 이미 다른 계정에 연동된 소셜 계정으로 업그레이드를 시도한 경우 (GROMO-585).
    // 게스트 상태는 유지하고 클라이언트가 기존 소셜 계정으로 로그인하도록 유도한다.
    SOCIAL_ACCOUNT_ALREADY_LINKED(HttpStatus.CONFLICT, "이미 다른 계정에 연동된 소셜 계정입니다");

    private final HttpStatus status;
    private final String message;

    AuthErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
