package com.oneorthree.business.common.exception;

import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.ApiResponses;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.api.PublicApiRoutes;
import com.oneorthree.business.common.api.RequestBodyTooLargeException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Comparator;

/** 신규 외부 오류만 공통 봉투로 변환하고 legacy 상류 status/code/message는 그대로 보존한다. */
@Slf4j
@RestControllerAdvice
@RequiredArgsConstructor
public class GlobalExceptionHandler {

    private final ApiResponses responses;

    @ExceptionHandler(UpstreamDomainException.class)
    public ResponseEntity<Object> handleUpstreamDomain(UpstreamDomainException error, HttpServletRequest request) {
        if (!PublicApiRoutes.usesEnvelope(request)) {
            Object body = error.getRetryAfterMs() == null
                    ? new ErrorResponse(error.getCode(), error.getUpstreamMessage())
                    : new RetryAfterErrorResponse(error.getCode(), error.getUpstreamMessage(), error.getRetryAfterMs());
            return ResponseEntity.status(error.resolvedStatus()).body(body);
        }
        ApiErrorCode mapped = registeredUpstream(error.getCode(), error.getStatus());
        if (mapped == null) {
            log.error("등록되지 않은 상류 오류 계약 — status={}", error.getStatus());
            return responses.error(request, ApiErrorCode.UPSTREAM_CONTRACT_ERROR, null, null);
        }
        var result = responses.error(request, mapped, defaultField(mapped), null);
        if (mapped.isRetryable() && error.getRetryAfterMs() != null && error.getRetryAfterMs() > 0) {
            long millis = error.getRetryAfterMs();
            long seconds = millis / 1000 + (millis % 1000 == 0 ? 0 : 1);
            HttpHeaders headers = new HttpHeaders();
            headers.putAll(result.getHeaders());
            headers.set(HttpHeaders.RETRY_AFTER, Long.toString(seconds));
            return new ResponseEntity<>(result.getBody(), headers, result.getStatusCode());
        }
        return result;
    }

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<Object> handleDomain(DomainException error, HttpServletRequest request) {
        if (!PublicApiRoutes.usesEnvelope(request)) {
            return legacy(error.getErrorCode());
        }
        ApiErrorCode code = publicCode(error.getErrorCode());
        if (error instanceof PublicApiException apiError) {
            return responses.error(request, code, apiError.getField(), apiError.getCurrent());
        }
        return responses.error(request, code, defaultField(code), null);
    }

    @ExceptionHandler(UpstreamUnavailableException.class)
    public ResponseEntity<Object> handleUnavailable(UpstreamUnavailableException error, HttpServletRequest request) {
        log.warn("상류 요청 일시 실패 — type={}", error.getClass().getSimpleName());
        return mapped(request, CommonErrorCode.UPSTREAM_UNAVAILABLE, ApiErrorCode.SERVICE_UNAVAILABLE, null);
    }

    @ExceptionHandler(UpstreamTimeoutException.class)
    public ResponseEntity<Object> handleTimeout(UpstreamTimeoutException error, HttpServletRequest request) {
        log.warn("상류 요청 시간 초과");
        return mapped(request, CommonErrorCode.UPSTREAM_UNAVAILABLE, ApiErrorCode.UPSTREAM_TIMEOUT, null);
    }

    @ExceptionHandler(CompositionCapacityExceededException.class)
    public ResponseEntity<Object> handleCapacity(CompositionCapacityExceededException error,
            HttpServletRequest request) {
        log.warn("화면 조합 처리 용량 초과");
        return mapped(request, CommonErrorCode.UPSTREAM_UNAVAILABLE, ApiErrorCode.SERVICE_UNAVAILABLE, null);
    }

    @ExceptionHandler(UpstreamCredentialRejectedException.class)
    public ResponseEntity<Object> handleCredentialRejected(UpstreamCredentialRejectedException error,
            HttpServletRequest request) {
        log.error("상류 서비스 자격 거절");
        return mapped(request, CommonErrorCode.UPSTREAM_CREDENTIAL_REJECTED, ApiErrorCode.UPSTREAM_AUTH_FAILED, null);
    }

    @ExceptionHandler(UpstreamContractMismatchException.class)
    public ResponseEntity<Object> handleContractMismatch(UpstreamContractMismatchException error,
            HttpServletRequest request) {
        log.error("상류 응답 계약 불일치");
        return mapped(request, CommonErrorCode.UPSTREAM_CONTRACT_MISMATCH, ApiErrorCode.UPSTREAM_CONTRACT_ERROR, null);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Object> handleValidation(MethodArgumentNotValidException error, HttpServletRequest request) {
        FieldError field = error.getBindingResult().getFieldErrors().stream()
                .min(Comparator.comparing(FieldError::getField)).orElse(null);
        ApiErrorCode code = field == null || field.getRejectedValue() == null
                ? ApiErrorCode.INVALID_REQUEST : ApiErrorCode.OUT_OF_RANGE;
        return mapped(request, CommonErrorCode.INVALID_REQUEST, code, field == null ? null : field.getField());
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<Object> handleConstraint(ConstraintViolationException error, HttpServletRequest request) {
        return mapped(request, CommonErrorCode.INVALID_REQUEST, ApiErrorCode.OUT_OF_RANGE, null);
    }

    @ExceptionHandler(RequestBodyTooLargeException.class)
    public ResponseEntity<Object> handleBodyTooLarge(RequestBodyTooLargeException error, HttpServletRequest request) {
        if (PublicApiRoutes.usesEnvelope(request)) {
            return responses.error(request, ApiErrorCode.REQUEST_TOO_LARGE, null, null);
        }
        return ResponseEntity.status(413)
                    .body(new ErrorResponse("REQUEST_TOO_LARGE", "요청을 처리할 수 없습니다."));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Object> handleUnreadable(HttpMessageNotReadableException error, HttpServletRequest request) {
        if (RequestBodyTooLargeException.causedBy(error)) {
            if (PublicApiRoutes.usesEnvelope(request)) {
                return responses.error(request, ApiErrorCode.REQUEST_TOO_LARGE, null, null);
            }
            return ResponseEntity.status(413)
                    .body(new ErrorResponse("REQUEST_TOO_LARGE", "요청을 처리할 수 없습니다."));
        }
        return mapped(request, CommonErrorCode.INVALID_REQUEST, ApiErrorCode.INVALID_REQUEST, null);
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MissingRequestHeaderException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Object> handleInvalidParameter(Exception error, HttpServletRequest request) {
        String field = null;
        if (error instanceof MissingServletRequestParameterException missing) {
            field = missing.getParameterName();
        } else if (error instanceof MissingRequestHeaderException missing) {
            field = missing.getHeaderName();
        } else if (error instanceof MethodArgumentTypeMismatchException mismatch) {
            field = mismatch.getName();
        }
        return mapped(request, CommonErrorCode.INVALID_PARAMETER, ApiErrorCode.INVALID_REQUEST, field);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Object> handleMediaType(HttpMediaTypeNotSupportedException error,
            HttpServletRequest request) {
        return withHeaders(mapped(request, CommonErrorCode.UNSUPPORTED_MEDIA_TYPE,
                ApiErrorCode.UNSUPPORTED_MEDIA_TYPE, null), error.getHeaders());
    }

    /** JSON을 거부한 요청에 오류 JSON을 강제하지 않는다. 오류 규약 §4의 406은 상태만 반환한다. */
    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<Void> handleNotAcceptable(HttpMediaTypeNotAcceptableException error) {
        return ResponseEntity.status(error.getStatusCode()).headers(error.getHeaders()).build();
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Object> handleMethod(HttpRequestMethodNotSupportedException error,
            HttpServletRequest request) {
        return withHeaders(mapped(request, CommonErrorCode.METHOD_NOT_ALLOWED,
                ApiErrorCode.METHOD_NOT_ALLOWED, null), error.getHeaders());
    }

    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    public ResponseEntity<Object> handleNotFound(Exception error, HttpServletRequest request) {
        return mapped(request, CommonErrorCode.ENDPOINT_NOT_FOUND, ApiErrorCode.RESOURCE_NOT_FOUND, null);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Object> handleUnexpected(Exception error, HttpServletRequest request) {
        // 원문 예외 메시지/본문/SQL을 로그나 공개 응답에 복사하지 않는다.
        log.error("처리하지 못한 예외 — type={}", error.getClass().getName());
        return mapped(request, CommonErrorCode.INTERNAL_ERROR, ApiErrorCode.INTERNAL_ERROR, null);
    }

    private ResponseEntity<Object> mapped(HttpServletRequest request, ErrorCode legacy, ApiErrorCode code,
            String field) {
        return PublicApiRoutes.usesEnvelope(request) ? responses.error(request, code, field, null) : legacy(legacy);
    }

    private ResponseEntity<Object> legacy(ErrorCode code) {
        return ResponseEntity.status(code.getStatus()).contentType(MediaType.APPLICATION_JSON)
                .body(new ErrorResponse(code.name(), code.getMessage()));
    }

    private ResponseEntity<Object> withHeaders(ResponseEntity<Object> result, HttpHeaders extra) {
        HttpHeaders headers = new HttpHeaders();
        headers.putAll(extra);
        headers.putAll(result.getHeaders());
        return new ResponseEntity<>(result.getBody(), headers, result.getStatusCode());
    }

    private ApiErrorCode publicCode(ErrorCode code) {
        if (code instanceof ApiErrorCode api) {
            return api;
        }
        return switch (code.name()) {
            case "USER_INACTIVE" -> ApiErrorCode.USER_NOT_FOUND;
            case "ENDPOINT_NOT_FOUND", "COMPAT_HANDLER_DISABLED" -> ApiErrorCode.RESOURCE_NOT_FOUND;
            case "UPSTREAM_UNAVAILABLE" -> ApiErrorCode.SERVICE_UNAVAILABLE;
            case "UPSTREAM_CREDENTIAL_REJECTED" -> ApiErrorCode.UPSTREAM_AUTH_FAILED;
            case "UPSTREAM_CONTRACT_MISMATCH" -> ApiErrorCode.UPSTREAM_CONTRACT_ERROR;
            default -> {
                ApiErrorCode registered = registeredUpstream(code.name(), code.getStatus().value());
                yield registered == null ? ApiErrorCode.UPSTREAM_CONTRACT_ERROR : registered;
            }
        };
    }

    private ApiErrorCode registeredUpstream(String code, int status) {
        if (status == 409 && "PUBLIC_COMMAND_CONTRACT_UNSUPPORTED".equals(code)) {
            return ApiErrorCode.STATE_CONFLICT;
        }
        if (status == 409 && "IDEMPOTENCY_KEY_CONFLICT".equals(code)) {
            return ApiErrorCode.IDEMPOTENCY_KEY_REUSED;
        }
        try {
            ApiErrorCode result = ApiErrorCode.valueOf(code);
            return result.getStatus().value() == status ? result : null;
        } catch (IllegalArgumentException | NullPointerException ignored) {
            return null;
        }
    }

    private String defaultField(ApiErrorCode code) {
        return switch (code) {
            case INVALID_IDEMPOTENCY_KEY, IDEMPOTENCY_KEY_REUSED -> "Idempotency-Key";
            case INVALID_CURSOR, CURSOR_EXPIRED -> "cursor";
            case INVITATION_EXPIRED -> "code";
            default -> null;
        };
    }
}
