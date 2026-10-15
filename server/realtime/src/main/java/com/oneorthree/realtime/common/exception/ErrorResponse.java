package com.oneorthree.realtime.common.exception;

import lombok.Getter;

/**
 * 에러 응답의 공통 봉투 — REST 는 본문으로, STOMP 는 에러 프레임 본문으로 같은 모양을 쓴다.
 *
 * <p>앱이 {@code code} 로 분기하므로 <b>필드 이름과 code 값이 계약</b>이다. 필드를 더해야 하면 이
 * 클래스를 고치지 말고 상속해서 additive 하게 늘린다.
 */
@Getter
public class ErrorResponse {

    private final String code;
    private final String message;

    /**
     * @param code 앱이 분기에 쓰는 기계용 식별자. 에러코드 enum 의 이름을 그대로 쓴다
     * @param message 사람이 읽는 설명. 화면에 그대로 노출될 수 있으므로 스택트레이스·SQL·내부 식별자처럼
     *                구현이 드러나는 문자열을 넣지 않는다
     */
    public ErrorResponse(String code, String message) {
        this.code = code;
        this.message = message;
    }

    /** 에러코드 하나에서 봉투를 만든다 — 호출부가 name()/getMessage() 를 매번 풀어 쓰지 않게. */
    public static ErrorResponse from(ErrorCode errorCode) {
        return new ErrorResponse(errorCode.name(), errorCode.getMessage());
    }
}
