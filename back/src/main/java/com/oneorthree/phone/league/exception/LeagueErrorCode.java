package com.oneorthree.phone.league.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum LeagueErrorCode {

    BATCH_ALREADY_RUN(HttpStatus.CONFLICT, "이번 주차 리그 배치가 이미 실행되었습니다."),
    TIER_CONFIG_NOT_FOUND(HttpStatus.INTERNAL_SERVER_ERROR, "리그 티어 설정을 찾을 수 없습니다."),
    INVALID_SCOPE(HttpStatus.BAD_REQUEST, "지원하지 않는 랭킹 scope 값입니다.");

    private final HttpStatus status;
    private final String message;

    LeagueErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
