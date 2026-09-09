package com.oneorthree.phone.auth.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 토큰 검증 실패 코드 — 전부 401 이다. 제공자별로 상수를 나눈 건 응답 본문의 {@code code} 로
 * 어느 제공자에서 막혔는지 앱과 로그가 구분하기 위한 것이고, <b>한 제공자 안에서는 실패 원인을
 * 더 쪼개지 않는다</b>(서명 불일치·만료·aud 불일치가 모두 같은 코드) — 공격자에게 어느 검증에서
 * 걸렸는지 알려 주지 않기 위해서다.
 *
 * <p>{@code REFRESH_TOKEN} 만 성격이 다르다: 외부 제공자가 아니라 <b>우리가 발급한</b> refresh 토큰의
 * 거절이며, 갱신·로그아웃 양쪽의 타입 가드와 해시 불일치가 모두 이 코드로 나온다.
 */
@Getter
public enum InvalidTokenErrorCode implements ErrorCode {

    KAKAO_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Kakao Token"),
    REFRESH_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Refresh Token"),
    APPLE_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Apple Token"),
    GOOGLE_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Google Token"),
    LINE_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Line Token"),
    INSTAGRAM_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Instagram Token"),
    FACEBOOK_TOKEN(HttpStatus.UNAUTHORIZED, "Invalid Facebook Token");

    private final HttpStatus status;
    private final String message;

    InvalidTokenErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
