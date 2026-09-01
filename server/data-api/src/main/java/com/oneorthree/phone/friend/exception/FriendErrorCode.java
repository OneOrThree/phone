package com.oneorthree.phone.friend.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 친구·핀 도메인의 실패 사유. 각 값이 HTTP 상태와 사용자 노출 문구를 함께 들고 있어, 예외를 던진 자리에서
 * 상태 코드를 고르지 않아도 된다.
 */
@Getter
public enum FriendErrorCode {
    // 잘못된 요청
    SELF_REQUEST(HttpStatus.BAD_REQUEST, "자기 자신에게는 친구 요청을 보낼 수 없습니다."),
    SELF_PIN(HttpStatus.BAD_REQUEST, "자기 자신은 핀할 수 없습니다."),

    // 비즈니스 로직상 충돌
    ALREADY_FRIEND(HttpStatus.CONFLICT, "이미 친구인 유저입니다."),
    REQUEST_ALREADY_EXISTS(HttpStatus.CONFLICT, "이미 보낸 친구 요청이 있습니다."),
    INVALID_REQUEST_STATUS(HttpStatus.CONFLICT, "이미 처리된 요청입니다."),

    // 권한
    NOT_REQUEST_RECEIVER(HttpStatus.FORBIDDEN, "요청 수신자만 수락/거절할 수 있습니다."),

    // 대상 없음
    REQUEST_NOT_FOUND(HttpStatus.NOT_FOUND, "친구 요청을 찾을 수 없습니다."),
    NOT_FRIEND(HttpStatus.NOT_FOUND, "친구 관계가 아닙니다.");

    private final HttpStatus status;
    private final String message;

    FriendErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
