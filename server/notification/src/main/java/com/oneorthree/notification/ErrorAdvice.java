package com.oneorthree.notification;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
class ErrorAdvice {

    @ExceptionHandler(NotificationFailure.class)
    ResponseEntity<Map<String, Object>> failure(NotificationFailure failure) {
        // 서비스 인증 오류를 앱 AT 오류로 전달하면 Business가 사용자 세션을 잘못 끊는다.
        Map<String, Object> body = failure.status() == 401 || failure.status() == 403
                ? Map.of("error", failure.getMessage()) : Map.of("code", failure.getMessage());
        return ResponseEntity.status(failure.status()).body(body);
    }
}
