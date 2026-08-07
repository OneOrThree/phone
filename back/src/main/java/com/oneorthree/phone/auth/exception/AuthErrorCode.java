package com.oneorthree.phone.auth.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum AuthErrorCode {

    // 게스트가 이미 다른 계정에 연동된 소셜 계정으로 업그레이드를 시도한 경우 (GROMO-585).
    // 게스트 상태는 유지하고 클라이언트가 기존 소셜 계정으로 로그인하도록 유도한다.
    SOCIAL_ACCOUNT_ALREADY_LINKED(HttpStatus.CONFLICT, "이미 다른 계정에 연동된 소셜 계정입니다"),

    // 이미 다른 소셜 계정으로 승격이 끝난 게스트의 AT 로 새 소셜 로그인을 시도한 경우 (GROMO-1229).
    // 같은 게스트 AT 로 두 기기가 서로 다른 소셜에 동시 로그인한 경쟁의 패자 — 신규 가입 폴백이
    // 만들 빈 유령 계정(닉네임 null)을 차단한다. 클라이언트는 재로그인해 승격된 계정을 쓰면 된다.
    GUEST_ALREADY_PROMOTED(HttpStatus.CONFLICT, "이미 다른 계정으로 승격된 게스트예요");

    private final HttpStatus status;
    private final String message;

    AuthErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
