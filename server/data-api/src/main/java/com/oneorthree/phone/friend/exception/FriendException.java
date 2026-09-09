package com.oneorthree.phone.friend.exception;

import com.oneorthree.phone.common.exception.DomainException;

/**
 * 친구·핀 도메인의 업무 규칙 위반. 언체크 예외라 서비스가 그대로 던지면 트랜잭션이 롤백되고,
 * 공통 핸들러가 {@link FriendErrorCode} 의 상태·문구로 응답을 만든다.
 */
public class FriendException extends DomainException {
    /** 응답 상태와 문구를 결정하는 실패 사유. */
    private final FriendErrorCode errorCode;

    /**
     * 사유의 문구를 예외 메시지로 그대로 쓴다 — 로그와 응답 본문이 갈리지 않게 하기 위해서다.
     *
     * @param errorCode 실패 사유
     */
    public FriendException(FriendErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }

    /**
     * @return 예외 핸들러가 HTTP 상태를 고를 때 읽는 실패 사유
     */
    public FriendErrorCode getErrorCode() {
        return errorCode;
    }
}
