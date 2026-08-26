package com.oneorthree.phone.league.exception;

import lombok.Getter;

@Getter
public class LeagueException extends RuntimeException {

    private final LeagueErrorCode errorCode;

    public LeagueException(LeagueErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}
