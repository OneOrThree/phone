package com.oneorthree.phone.exception;

public class InvalidKakaoTokenException extends RuntimeException {
    public InvalidKakaoTokenException() {
        super("유효하지 않은 카카오 액세스 토큰입니다.");
    }
}
