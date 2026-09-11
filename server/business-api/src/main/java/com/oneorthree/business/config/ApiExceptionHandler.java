package com.oneorthree.business.config;

import com.oneorthree.business.linkpreview.exception.PreviewException;
import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(PreviewException.class)
    public ResponseEntity<Map<String, String>> preview(PreviewException error) {
        int status = switch (error.getCode()) {
            case "RATE_LIMITED" -> 429;
            case "NOT_FOUND" -> 404;
            default -> 400;
        };
        var response = ResponseEntity.status(status);
        if (status == 429) {
            response.header("Retry-After", "60");
        }
        return response.body(Map.of("code", error.getCode(), "message", "미리보기 요청을 처리할 수 없습니다."));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<Map<String, String>> invalid(Exception error) {
        return ResponseEntity.badRequest().body(Map.of("code", "INVALID_REQUEST", "message", "요청 형식을 확인해 주세요."));
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<Map<String, String>> unavailable(DataAccessException error) {
        return ResponseEntity.status(503).header("Retry-After", "10")
                .body(Map.of("code", "SERVICE_UNAVAILABLE", "message", "잠시 후 다시 시도해 주세요."));
    }
}
