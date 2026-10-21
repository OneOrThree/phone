package com.oneorthree.realtime.message.exception;

import com.oneorthree.realtime.common.exception.DomainException;

/**
 * 채팅 도메인이 던지는 유일한 예외 타입. 이유는 {@link ChatErrorCode} 가 들고 있다.
 *
 * <p>REST 경로에서는 {@code GlobalExceptionHandler} 가, STOMP 경로에서는
 * {@code ChatStompController} 의 {@code @MessageExceptionHandler} 가 이 타입을 잡아 같은 봉투로 바꾼다.
 */
public class ChatException extends DomainException {

    /** 섬 구독 인가 거절이 실어 보내는 채널(events|movement) — ERROR 프레임 {@code channel} 헤더가 된다. 없으면 null. */
    private String channel;

    public ChatException(ChatErrorCode errorCode) {
        super(errorCode);
    }

    public String getChannel() {
        return channel;
    }

    public void setChannel(String channel) {
        this.channel = channel;
    }
}
