package com.oneorthree.chat.common.exception;

import lombok.Getter;

/**
 * 이 서비스가 «의도적으로» 거절할 때 던지는 예외의 뿌리.
 *
 * <p>{@code GlobalExceptionHandler} 하나가 이 타입만 보고 봉투를 만든다 — 도메인마다 핸들러를 두지
 * 않는다. 반대로 도메인 예외가 아닌 것(NPE·드라이버 오류 등)은 절대 이 타입으로 감싸지 않는다.
 * 그건 «우리가 예상한 거절»이 아니라 «우리가 몰랐던 고장»이고, 둘을 섞으면 500 이 4xx 로 위장돼
 * 알림·대시보드에서 사라진다.
 */
@Getter
public abstract class DomainException extends RuntimeException {

    private final transient ErrorCode errorCode;

    protected DomainException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}
