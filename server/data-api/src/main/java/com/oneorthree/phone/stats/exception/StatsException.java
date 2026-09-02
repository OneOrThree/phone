package com.oneorthree.phone.stats.exception;

import lombok.Getter;

/**
 * 통계 조회의 입력 규칙 위반. 언체크 예외라 그대로 던지면 공통 핸들러가 {@link StatsErrorCode} 의
 * 상태·문구로 응답을 만든다.
 */
@Getter
public class StatsException extends RuntimeException {

    /** 응답 상태와 문구를 결정하는 실패 사유. */
    private final StatsErrorCode errorCode;

    /**
     * 사유의 문구를 예외 메시지로 그대로 쓴다 — 로그와 응답 본문이 갈리지 않게 하기 위해서다.
     *
     * @param errorCode 실패 사유
     */
    public StatsException(StatsErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}
