package com.oneorthree.phone.league.exception;

import lombok.Getter;

/**
 * 리그 도메인의 업무 규칙 위반. 언체크 예외라 서비스가 그대로 던지면 트랜잭션이 롤백되고, 공통 핸들러가
 * {@link LeagueErrorCode} 의 상태·문구로 응답을 만든다.
 */
@Getter
public class LeagueException extends RuntimeException {

    /** 응답 상태와 문구를 결정하는 실패 사유. */
    private final LeagueErrorCode errorCode;

    /**
     * 사유의 문구를 예외 메시지로 그대로 쓴다 — 로그와 응답 본문이 갈리지 않게 하기 위해서다.
     *
     * @param errorCode 실패 사유
     */
    public LeagueException(LeagueErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}
