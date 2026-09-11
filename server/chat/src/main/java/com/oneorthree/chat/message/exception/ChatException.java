package com.oneorthree.chat.message.exception;

import com.oneorthree.chat.common.exception.DomainException;

/**
 * 채팅 도메인이 던지는 유일한 예외 타입. 이유는 {@link ChatErrorCode} 가 들고 있다.
 *
 * <p>REST 경로에서는 {@code GlobalExceptionHandler} 가, STOMP 경로에서는
 * {@code ChatStompController} 의 {@code @MessageExceptionHandler} 가 이 타입을 잡아 같은 봉투로 바꾼다.
 */
public class ChatException extends DomainException {

    public ChatException(ChatErrorCode errorCode) {
        super(errorCode);
    }
}
