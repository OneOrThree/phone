package com.oneorthree.business.common.api;

import com.oneorthree.business.common.exception.ErrorCode;
import org.springframework.http.HttpStatus;

/** GROMO-1750 신규 공개 오류 표. legacy 오류 상수와 분리한다. */
public enum ApiErrorCode implements ErrorCode {
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않습니다.", false),
    INVALID_PARAMETER(HttpStatus.BAD_REQUEST, "요청 파라미터가 올바르지 않습니다.", false),
    INVALID_IDEMPOTENCY_KEY(HttpStatus.BAD_REQUEST, "명령 키가 올바르지 않습니다.", false),
    INVALID_CURSOR(HttpStatus.BAD_REQUEST, "목록 커서가 올바르지 않습니다.", false),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "인증이 필요합니다. 다시 로그인해 주세요.", false),
    FORBIDDEN(HttpStatus.FORBIDDEN, "이 작업을 수행할 권한이 없습니다.", false),
    FACILITY_LOCKED(HttpStatus.FORBIDDEN, "필요한 시설을 먼저 열어 주세요.", false),
    NOT_FOUND(HttpStatus.NOT_FOUND, "요청한 대상을 찾을 수 없습니다.", false),
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "사용자를 찾을 수 없습니다. 다시 로그인해 주세요.", false),
    RESOURCE_NOT_FOUND(HttpStatus.NOT_FOUND, "요청 경로를 찾을 수 없습니다.", false),
    PRODUCT_NOT_FOUND(HttpStatus.NOT_FOUND, "상품을 찾을 수 없습니다.", false),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "지원하지 않는 요청 방식입니다.", false),
    VERSION_CONFLICT(HttpStatus.CONFLICT, "상태가 변경되었습니다. 최신 내용을 확인해 주세요.", false),
    STATE_CONFLICT(HttpStatus.CONFLICT, "현재 상태에서는 이 작업을 수행할 수 없습니다.", false),
    INSUFFICIENT_FUNDS(HttpStatus.CONFLICT, "잔액이 부족합니다.", false),
    IDEMPOTENCY_KEY_REUSED(HttpStatus.CONFLICT, "다른 요청에 사용한 명령 키입니다.", false),
    REQUEST_IN_PROGRESS(HttpStatus.CONFLICT, "요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.", true),
    CURSOR_EXPIRED(HttpStatus.CONFLICT, "목록 커서가 만료되었습니다. 처음부터 조회해 주세요.", false),
    INVITATION_EXPIRED(HttpStatus.GONE, "초대가 만료되었거나 폐기되었습니다.", false),
    REQUEST_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "요청 본문이 너무 큽니다.", false),
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "지원하지 않는 요청 형식입니다.", false),
    OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "입력값이 허용 범위를 벗어났습니다.", false),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "요청이 많습니다. 잠시 후 다시 시도해 주세요.", true),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "요청을 처리할 수 없습니다.", false),
    UPSTREAM_CONTRACT_ERROR(HttpStatus.BAD_GATEWAY, "요청을 처리할 수 없습니다.", false),
    UPSTREAM_AUTH_FAILED(HttpStatus.BAD_GATEWAY, "요청을 처리할 수 없습니다.", false),
    SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "잠시 후 다시 시도해 주세요.", true),
    UPSTREAM_TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", true);

    private final HttpStatus status;
    private final String message;
    private final boolean retryable;

    ApiErrorCode(HttpStatus status, String message, boolean retryable) {
        this.status = status;
        this.message = message;
        this.retryable = retryable;
    }

    @Override
    public HttpStatus getStatus() {
        return status;
    }

    @Override
    public String getMessage() {
        return message;
    }

    public boolean isRetryable() {
        return retryable;
    }
}
