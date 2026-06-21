package com.oneorthree.phone.exception;

import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.zone.ZoneRulesException;

@RestControllerAdvice
public class LegacyGlobalExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<String> handleIllegalArgument(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
    }

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<String> handleUserNotFound(UserNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<String> handleForbidden(ForbiddenException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(e.getMessage());
    }

    @ExceptionHandler(FocusTagNotFoundException.class)
    public ResponseEntity<String> handleFocusTagNotFound(FocusTagNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
    }

    @ExceptionHandler(CurrencyException.class)
    public ResponseEntity<String> handleCurrency(CurrencyException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(e.getMessage());
    }

    @ExceptionHandler(InvalidTokenException.class)
    public ResponseEntity<String> handleToken(InvalidTokenException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(e.getMessage());
    }

    @ExceptionHandler(GroupException.class)
    public ResponseEntity<String> handleGroup(GroupException e) {
        return ResponseEntity.status(e.getErrorCode().getStatus()).body(e.getMessage());
    }

    @ExceptionHandler(ZoneRulesException.class)
    public ResponseEntity<String> handleZoneRulesException(ZoneRulesException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(e.getMessage());
    }

    /*
    @todo 낙관적락 exception 추후 분기 필요
     */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<String> handleOptimisticLock(OptimisticLockingFailureException e) {
        return ResponseEntity.status(GroupErrorCode.ROOM_FULL.getStatus())
                .body(GroupErrorCode.ROOM_FULL.getMessage());
    }
}
